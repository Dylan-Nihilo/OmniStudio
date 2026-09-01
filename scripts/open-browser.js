const { exec } = require('child_process');

const frontendPort = process.env.PORT || process.env.OMNI_STUDIO_FRONTEND_PORT || '3008';
const backendPort = process.env.OMNI_STUDIO_BACKEND_PORT || process.env.NEXT_PUBLIC_BACKEND_PORT || '17177';
const URL = `http://localhost:${frontendPort}`;

setTimeout(() => {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║                                          ║');
  console.log('  ║   Omni Studio AI Comic Platform Ready!        ║');
  console.log('  ║                                          ║');
  console.log(`  ║   Frontend:  ${URL}`);
  console.log(`  ║   Backend:   http://localhost:${backendPort}`);
  console.log('  ║                                          ║');
  console.log('  ║   Press Ctrl+C to stop all services.     ║');
  console.log('  ║                                          ║');
  console.log('  ╚══════════════════════════════════════════╝\n');

  const cmd = process.platform === 'win32' ? `start "" "${URL}"`
    : process.platform === 'darwin' ? `open "${URL}"`
    : `xdg-open "${URL}"`;
  exec(cmd);
}, 5000);
