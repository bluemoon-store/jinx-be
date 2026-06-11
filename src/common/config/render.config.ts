import { registerAs } from '@nestjs/config';

export default registerAs(
    'render',
    (): Record<string, any> => ({
        // Base URL of the jinx-pdf render service (server-to-server).
        pdfServiceUrl: process.env.PDF_SERVICE_URL,
        // Shared secret sent as x-render-secret; must match jinx-pdf.
        secret: process.env.RENDER_SHARED_SECRET,
    })
);
