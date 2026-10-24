import express from "express";
import nodemailer from "nodemailer";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import PDFDocument from "pdfkit";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: Record<string, unknown> = {};
if (fs.existsSync(firebaseConfigPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8")) as Record<string, unknown>;
  } catch {
    throw new Error("Configuration Firebase invalide dans firebase-applet-config.json.");
  }
}

const projectId = process.env.FIREBASE_PROJECT_ID || String(firebaseConfig.projectId || "");
if (!projectId) {
  throw new Error("Configuration Firebase manquante : définissez FIREBASE_PROJECT_ID ou ajoutez firebase-applet-config.json.");
}
const databaseId = process.env.FIRESTORE_DATABASE_ID ||
  String(firebaseConfig.firestoreDatabaseId || "(default)");

function loadServiceAccount() {
  const configuredAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!configuredAccount) return applicationDefault();

  try {
    const rawJson = configuredAccount.trim().startsWith("{")
      ? configuredAccount
      : Buffer.from(configuredAccount, "base64").toString("utf8");
    const serviceAccount = JSON.parse(rawJson);
    if (!serviceAccount || typeof serviceAccount !== "object" || !serviceAccount.private_key || !serviceAccount.client_email) {
      throw new Error();
    }
    return cert(serviceAccount);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT doit contenir un compte de service Firebase valide en JSON ou en base64.");
  }
}

// Initialize Firebase Admin without logging credentials or configuration values.
const adminApp = initializeApp({
  credential: loadServiceAccount(),
  projectId
});
const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp, databaseId);
const APP_NAME = process.env.APP_NAME?.trim() || "Phone Clinic";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN?.trim();

// No super-admin is configured by default; set the allowed accounts via environment.
const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MIN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// Verifies the Firebase ID token sent as "Authorization: Bearer <token>".
// Exposes the caller on res.locals (authUid, isSuperAdmin).
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!match) return res.status(401).json({ error: "Authentification requise." });
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    res.locals.authUid = decoded.uid;
    res.locals.isSuperAdmin =
      decoded.email_verified === true &&
      !!decoded.email &&
      SUPER_ADMIN_EMAILS.includes(decoded.email.toLowerCase());
    next();
  } catch {
    res.status(401).json({ error: "Jeton invalide ou expiré." });
  }
}

// Requires the caller to be a super-admin or the admin of their own store.
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (res.locals.isSuperAdmin) return next();
  try {
    const snap = await adminDb.collection("users").doc(res.locals.authUid).get();
    const data = snap.data();
    if (snap.exists && data?.role === "admin" && data?.status !== "banned" && (data?.ownerId || snap.id) === snap.id) {
      return next();
    }
    res.status(403).json({ error: "Accès refusé." });
  } catch {
    res.status(500).json({ error: "Erreur de vérification des droits." });
  }
}

// A non-super-admin may only manage collaborators that belong to their own store.
async function canManageTarget(res: Response, targetUid: string): Promise<boolean> {
  if (res.locals.isSuperAdmin) return true;
  if (targetUid === res.locals.authUid) return false;
  const snap = await adminDb.collection("users").doc(targetUid).get();
  return snap.exists && snap.data()?.ownerId === res.locals.authUid;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function safeFilenamePart(v: unknown): string {
  return String(v ?? "ticket").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 50) || "ticket";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char] || char);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : { origin: false }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/healthz", (_req, res) => {
    res.sendStatus(200);
  });

  // API endpoints for User Administration (syncing with Firebase Auth + Firestore)
  app.post("/api/admin/users/create", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { email, password, role, allowedMenus } = req.body;
      if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
        return res.status(400).json({ error: "Email et mot de passe requis." });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Mot de passe : 6 caractères minimum." });
      }
      if (role !== undefined && role !== "admin" && role !== "user") {
        return res.status(400).json({ error: "Rôle invalide." });
      }
      if (allowedMenus !== undefined && !isStringArray(allowedMenus)) {
        return res.status(400).json({ error: "allowedMenus invalide." });
      }

      // Only a super-admin may create admins; a store admin only creates collaborators of their own store.
      const targetRole = res.locals.isSuperAdmin ? (role || "user") : "user";
      let sanitizedMenus = allowedMenus || [];
      if (targetRole !== "admin") {
        sanitizedMenus = sanitizedMenus.filter((m: string) => m !== "users" && m !== "settings");
      }

      // 1. Create the user in Firebase Auth
      const userRecord = await adminAuth.createUser({
        email,
        password,
      });

      // 2. Create the document in Firestore
      await adminDb.collection("users").doc(userRecord.uid).set({
        uid: userRecord.uid,
        email,
        role: targetRole,
        status: "active",
        allowedMenus: sanitizedMenus,
        ownerId: res.locals.isSuperAdmin ? userRecord.uid : res.locals.authUid
      });

      res.json({ success: true, user: { uid: userRecord.uid, email: userRecord.email } });
    } catch (err: any) {
      console.error("Error creating user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/users/update", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { uid, email, password, role, allowedMenus, status } = req.body;
      if (typeof uid !== "string" || !uid) {
        return res.status(400).json({ error: "UID requis." });
      }
      if (!(await canManageTarget(res, uid))) {
        return res.status(403).json({ error: "Accès refusé." });
      }
      if (role !== undefined && role !== "admin" && role !== "user") {
        return res.status(400).json({ error: "Rôle invalide." });
      }
      if (role === "admin" && !res.locals.isSuperAdmin) {
        return res.status(403).json({ error: "Accès refusé." });
      }
      if (status !== undefined && status !== "active" && status !== "banned") {
        return res.status(400).json({ error: "Statut invalide." });
      }
      if (allowedMenus !== undefined && !isStringArray(allowedMenus)) {
        return res.status(400).json({ error: "allowedMenus invalide." });
      }
      if ((email !== undefined && typeof email !== "string") || (password !== undefined && typeof password !== "string")) {
        return res.status(400).json({ error: "Paramètres invalides." });
      }
      if (password && password.length < 8) {
        return res.status(400).json({ error: "Mot de passe : 8 caractères minimum." });
      }

      // Fetch existing user from Firestore to determine their final role if not provided in request body
      let finalRole = role;
      let existingMenus = [];
      const userRef = adminDb.collection("users").doc(uid);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (!finalRole) {
          finalRole = userData?.role || "user";
        }
        existingMenus = userData?.allowedMenus || [];
      }

      // Update in Firebase Auth
      const authUpdates: any = {};
      if (email) authUpdates.email = email;
      if (password) authUpdates.password = password;

      if (Object.keys(authUpdates).length > 0) {
        await adminAuth.updateUser(uid, authUpdates);
      }

      // Update in Firestore
      const firestoreUpdates: any = {};
      if (email) firestoreUpdates.email = email;
      if (role) firestoreUpdates.role = role;
      
      if (allowedMenus) {
        let sanitizedMenus = allowedMenus;
        if (finalRole !== "admin") {
          sanitizedMenus = sanitizedMenus.filter((m: string) => m !== "users" && m !== "settings");
        }
        firestoreUpdates.allowedMenus = sanitizedMenus;
      } else if (role && finalRole !== "admin") {
        // If role changed to non-admin but menus were not passed, filter original ones
        firestoreUpdates.allowedMenus = existingMenus.filter((m: string) => m !== "users" && m !== "settings");
      }
      
      if (status) firestoreUpdates.status = status;

      if (Object.keys(firestoreUpdates).length > 0) {
        await userRef.update(firestoreUpdates);
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error updating user:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/users/delete", requireAuth, requireAdmin, async (req, res) => {
    let profileRemoved = false;
    try {
      const { uid } = req.body;
      if (typeof uid !== "string" || !uid) {
        return res.status(400).json({ error: "UID requis." });
      }
      if (uid === res.locals.authUid) {
        return res.status(400).json({ error: "Un administrateur ne peut pas supprimer son propre compte." });
      }
      if (!(await canManageTarget(res, uid))) {
        return res.status(403).json({ error: "Accès refusé." });
      }

      const targetRef = adminDb.collection("users").doc(uid);
      await adminDb.runTransaction(async (transaction) => {
        const targetProfile = await transaction.get(targetRef);
        if (!targetProfile.exists) {
          throw Object.assign(new Error("Profil utilisateur introuvable."), { status: 404 });
        }

        const targetData = targetProfile.data()!;
        if (targetData.role === "admin") {
          const administrators = await transaction.get(
            adminDb.collection("users").where("role", "==", "admin")
          );
          const storeOwnerId = String(targetData.ownerId || uid);
          const remainingAdmins = administrators.docs.filter((admin) =>
            String(admin.data().ownerId || admin.id) === storeOwnerId && admin.id !== uid
          );
          if (!remainingAdmins.length) {
            throw Object.assign(new Error("Impossible de supprimer le dernier administrateur du magasin."), { status: 409 });
          }
        }

        transaction.delete(targetRef);
      });
      profileRemoved = true;

      try {
        await adminAuth.deleteUser(uid);
      } catch (authErr) {
        if (
          typeof authErr === "object" &&
          authErr !== null &&
          "code" in authErr &&
          authErr.code === "auth/user-not-found"
        ) {
          // Remove a stale Firestore profile when its Auth account is already absent.
        } else {
          throw authErr;
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Unable to delete the requested user.");
      const status = typeof error === "object" && error !== null && "status" in error &&
        typeof error.status === "number" ? error.status : 500;
      const message = profileRemoved
        ? "Profil retiré, mais la suppression du compte Firebase Authentication a échoué. Contactez l’administrateur."
        : status < 500 && error instanceof Error
          ? error.message
          : "Impossible de supprimer cet utilisateur.";
      res.status(status).json({ error: message });
    }
  });

  // API Route to generate PDF
  app.post("/api/invoices/pdf", requireAuth, (req, res) => {
    const invoice = req.body && typeof req.body === "object" ? req.body : {};
    const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    try {
      const storeName = typeof invoice.storeName === "string" && invoice.storeName.trim()
        ? invoice.storeName.trim()
        : APP_NAME;
      const address = typeof invoice.address === "string" ? invoice.address.trim() : "";
      const phone = typeof invoice.phone === "string" ? invoice.phone.trim() : "";
      const doc = new PDFDocument({ size: [226, 600], margin: 10 }); // Thermal printer size (approx 80mm)

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=facture-${safeFilenamePart(invoice.number)}.pdf`);

      doc.pipe(res);

      // Header
      doc.fontSize(14).text(storeName, { align: "center" });
      if (address) doc.fontSize(8).text(address, { align: "center" });
      if (phone) doc.fontSize(8).text(phone, { align: "center" });
      doc.moveDown();

      doc.fontSize(10).text(`FACTURE: ${invoice.number || ""}`, { align: "center" });
      doc.fontSize(8).text(`Date: ${invoice.date || ""}`, { align: "center" });
      doc.moveDown();

      // Client Info
      if (invoice.clientName) doc.text(`Client: ${invoice.clientName}`);
      if (invoice.clientCode) doc.text(`Code Client: ${invoice.clientCode}`);
      if (invoice.clientPhone) doc.text(`Tel: ${invoice.clientPhone}`);
      if (invoice.clientAddress) doc.text(`Adresse: ${invoice.clientAddress}`);
      doc.moveDown();

      // Table Header
      doc.text("------------------------------------------");
      doc.text("Produit          Qté   Prix   Total");
      doc.text("------------------------------------------");

      // Items
      if (Array.isArray(invoice.items)) {
        invoice.items.forEach((item: any) => {
          const name = String(item?.name || "").substring(0, 15).padEnd(16);
          const qty = String(item?.quantity || 1).padStart(3);
          const price = num(item?.price).toFixed(2).padStart(7);
          const total = num(item?.total).toFixed(2).padStart(7);
          doc.text(`${name} ${qty} ${price} ${total}`);
        });
      }

      doc.text("------------------------------------------");
      doc.moveDown();

      // Totals
      const total = num(invoice.total);
      const tva = num(invoice.tva);
      const paid = num(invoice.paid);
      const debt = num(invoice.debt);
      const subtotal = total - tva;
      if (tva > 0) {
        doc.fontSize(10).text(`Sous-total: ${subtotal.toFixed(2)} DT`, { align: "right" });
        doc.fontSize(10).text(`TVA: ${tva.toFixed(2)} DT`, { align: "right" });
      }
      doc.fontSize(12).font("Helvetica-Bold").text(`TOTAL GENERAL: ${total.toFixed(2)} DT`, { align: "right" });
      doc.fontSize(10).font("Helvetica").text(`Payé: ${paid.toFixed(2)} DT`, { align: "right" });
      if (debt > 0) {
        doc.fillColor("red").text(`Reste (Dette): ${debt.toFixed(2)} DT`, { align: "right" });
      }

      doc.moveDown();
      doc.fontSize(8).fillColor("black").text("Merci de votre confiance !", { align: "center" });

      doc.end();
    } catch (err) {
      console.error("[PDF]", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Erreur de génération du PDF." });
      } else {
        res.end();
      }
    }
  });

  // ── OTP SEND ENDPOINT ──────────────────────────────────────────────────
  app.post("/api/otp/send", requireAuth, async (req, res) => {
    try {
      if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        return res.status(503).json({ error: "Envoi d'email non configuré" });
      }
      const { uid } = req.body;
      if (typeof uid !== "string" || !uid) return res.status(400).json({ error: "uid requis" });
      // A code can only be requested for the authenticated account itself.
      if (uid !== res.locals.authUid) return res.status(403).json({ error: "Accès refusé." });

      // Throttle: one code per minute (prevents email flooding)
      const previous = await adminDb.collection("otp_codes").doc(uid).get();
      if (previous.exists) {
        const prevCreated = Number(previous.data()?.createdAtMs || 0);
        if (Date.now() - prevCreated < OTP_RESEND_MIN_MS) {
          return res.status(429).json({ error: "Veuillez patienter avant de redemander un code." });
        }
      }

      // Get user email from Firebase Auth
      const userRecord = await adminAuth.getUser(uid);
      const email = userRecord.email;
      if (!email) return res.status(400).json({ error: "Email introuvable" });

      // Generate 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = Date.now() + OTP_TTL_MS; // 5 minutes

      // Store OTP in Firestore
      await adminDb.collection("otp_codes").doc(uid).set({
        otp,
        expiresAt,
        email,
        attempts: 0,
        createdAtMs: Date.now(),
        createdAt: new Date().toISOString()
      });

      // Send email via nodemailer (Gmail)
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD
        }
      });

      await transporter.sendMail({
        from: `"${APP_NAME}" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `Code de vérification - ${APP_NAME}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 12px;">
            <h2 style="color: #1e293b; margin-bottom: 8px;">${escapeHtml(APP_NAME)} - Code de vérification</h2>
            <p style="color: #64748b; margin-bottom: 24px;">Vous avez demandé à modifier votre code de sécurité dans ${escapeHtml(APP_NAME)}.</p>
            <div style="background: #fff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
              <p style="color: #94a3b8; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px;">Votre code</p>
              <span style="font-size: 36px; font-weight: 900; letter-spacing: 12px; color: #e11d48; font-family: monospace;">${otp}</span>
            </div>
            <p style="color: #94a3b8; font-size: 12px;">Ce code expire dans <strong>5 minutes</strong>. Ne le partagez avec personne.</p>
          </div>
        `
      });

      res.json({ success: true, email: email.replace(/(.{2}).*(@.*)/, "$1***$2") });
    } catch (err: any) {
      console.error("[OTP SEND]", err);
      res.status(500).json({ error: "Erreur envoi OTP" });
    }
  });

  app.post("/api/otp/verify", requireAuth, async (req, res) => {
    try {
      const { uid, otp } = req.body;
      if (typeof uid !== "string" || typeof otp !== "string" || !uid || !otp) {
        return res.status(400).json({ error: "Paramètres manquants" });
      }
      if (uid !== res.locals.authUid) return res.status(403).json({ error: "Accès refusé." });

      const ref = adminDb.collection("otp_codes").doc(uid);
      const snap = await ref.get();
      if (!snap.exists) return res.status(400).json({ error: "Aucun code trouvé" });

      const data = snap.data()!;
      if (Date.now() > data.expiresAt) {
        await ref.delete();
        return res.status(400).json({ error: "Code expiré" });
      }
      if ((data.attempts || 0) >= OTP_MAX_ATTEMPTS) {
        await ref.delete();
        return res.status(429).json({ error: "Trop de tentatives. Demandez un nouveau code." });
      }

      const expected = Buffer.from(String(data.otp));
      const given = Buffer.from(otp);
      const matches = expected.length === given.length && crypto.timingSafeEqual(expected, given);
      if (!matches) {
        await ref.update({ attempts: (data.attempts || 0) + 1 });
        return res.status(400).json({ error: "Code incorrect" });
      }

      // OTP valid — delete it
      await ref.delete();
      res.json({ success: true });
    } catch (err: any) {
      console.error("[OTP VERIFY]", err);
      res.status(500).json({ error: "Erreur de vérification du code" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV === "development") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer();
