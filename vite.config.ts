import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import PDFDocument from 'pdfkit';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

function pdfApiPlugin(environment: Record<string, string>): Plugin {
  return {
    name: 'pdf-api-plugin',
    configureServer(server) {
      server.middlewares.use('/api/invoices/pdf', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const invoice = JSON.parse(body || '{}');
            const document = new PDFDocument({ size: [226, 600], margin: 10 });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
              'Content-Disposition',
              `attachment; filename=facture-${String(invoice.number ?? 'ticket').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 50) || 'ticket'}.pdf`,
            );
            document.pipe(res);
            document.fontSize(14).text(
              typeof invoice.storeName === 'string' && invoice.storeName.trim()
                ? invoice.storeName.trim()
                : environment.VITE_APP_NAME?.trim() || 'Phone Clinic',
              { align: 'center' },
            );
            if (typeof invoice.address === 'string' && invoice.address.trim()) {
              document.fontSize(8).text(invoice.address.trim(), { align: 'center' });
            }
            if (typeof invoice.phone === 'string' && invoice.phone.trim()) {
              document.fontSize(8).text(invoice.phone.trim(), { align: 'center' });
            }
            document.moveDown();
            document.fontSize(10).text(`FACTURE: ${invoice.number || ''}`, { align: 'center' });
            document.fontSize(8).text(`Date: ${invoice.date || ''}`, { align: 'center' });
            document.moveDown();
            if (invoice.clientName) document.text(`Client: ${invoice.clientName}`);
            if (invoice.clientCode) document.text(`Code Client: ${invoice.clientCode}`);
            if (invoice.clientPhone) document.text(`Tel: ${invoice.clientPhone}`);
            if (invoice.clientAddress) document.text(`Adresse: ${invoice.clientAddress}`);
            document.moveDown();
            document.text('------------------------------------------');
            document.text('Produit          Qté   Prix   Total');
            document.text('------------------------------------------');
            if (Array.isArray(invoice.items)) {
              invoice.items.forEach((item: any) => {
                const name = String(item?.name || '').substring(0, 15).padEnd(16);
                const quantity = String(item?.quantity || 1).padStart(3);
                const price = (Number(item?.price) || 0).toFixed(2).padStart(7);
                const total = (Number(item?.total) || 0).toFixed(2).padStart(7);
                document.text(`${name} ${quantity} ${price} ${total}`);
              });
            }
            document.text('------------------------------------------');
            document.moveDown();
            const total = Number(invoice.total) || 0;
            const tva = Number(invoice.tva) || 0;
            if (tva > 0) {
              document.fontSize(10).text(`Sous-total: ${(total - tva).toFixed(2)} DT`, { align: 'right' });
              document.fontSize(10).text(`TVA: ${tva.toFixed(2)} DT`, { align: 'right' });
            }
            document.fontSize(12).font('Helvetica-Bold').text(`TOTAL GENERAL: ${total.toFixed(2)} DT`, { align: 'right' });
            document.fontSize(10).font('Helvetica').text(`Payé: ${(Number(invoice.paid) || 0).toFixed(2)} DT`, { align: 'right' });
            if ((Number(invoice.debt) || 0) > 0) {
              document.fillColor('red').text(`Reste (Dette): ${Number(invoice.debt).toFixed(2)} DT`, { align: 'right' });
            }
            document.moveDown();
            document.fontSize(8).fillColor('black').text('Merci de votre confiance !', { align: 'center' });
            document.end();
          } catch (error) {
            console.error('PDF generation failed:', error);
            if (!res.headersSent) res.statusCode = 500;
            res.end('Error generating PDF');
          }
        });
      });
    },
  };
}

function salesBuildPlugin(environment: Record<string, string>): Plugin {
  const brand = {
    name: environment.VITE_APP_NAME?.trim() || 'Phone Clinic',
    shortName: environment.VITE_APP_SHORT_NAME?.trim() || 'Phone Clinic',
    tagline: environment.VITE_APP_TAGLINE?.trim() || 'Caisse & Réparation',
    primaryColor: environment.VITE_APP_PRIMARY_COLOR?.trim() || '#4f46e5',
    logo: environment.VITE_APP_LOGO?.trim() || '/icon.svg',
  };
  const buildId = Date.now().toString(36);

  return {
    name: 'sales-build-config',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const replacements: Record<string, string> = {
          '%VITE_APP_NAME%': brand.name,
          '%VITE_APP_SHORT_NAME%': brand.shortName,
          '%VITE_APP_TAGLINE%': brand.tagline,
          '%VITE_APP_PRIMARY_COLOR%': brand.primaryColor,
          '%VITE_APP_LOGO%': brand.logo,
          '%VITE_BUILD_ID%': buildId,
        };
        return Object.entries(replacements).reduce(
          (result, [placeholder, value]) => result.replaceAll(placeholder, value),
          html,
        );
      },
    },
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.webmanifest',
        source: JSON.stringify({
          name: brand.name,
          short_name: brand.shortName,
          description: `${brand.name} — ${brand.tagline}`,
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          lang: 'fr',
          theme_color: brand.primaryColor,
          background_color: brand.primaryColor,
          categories: ['business', 'productivity'],
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        }, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [salesBuildPlugin(environment), react(), tailwindcss(), pdfApiPlugin(environment)],
    resolve: {
      alias: { '@': rootDirectory },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
    server: {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
