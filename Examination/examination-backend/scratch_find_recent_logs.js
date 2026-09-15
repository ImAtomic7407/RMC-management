const fs = require('fs');
const path = require('path');

const logsDir = 'C:\\Users\\sunny\\.pm2\\logs';
try {
  const files = fs.readdirSync(logsDir);
  const now = Date.now();
  const recentFiles = [];

  for (const file of files) {
    const filePath = path.join(logsDir, file);
    const stats = fs.statSync(filePath);
    const ageMs = now - stats.mtimeMs;
    // Modified in the last 30 minutes
    if (ageMs < 30 * 60 * 1000) {
      recentFiles.push({ file, ageMs, size: stats.size });
    }
  }

  recentFiles.sort((a, b) => a.ageMs - b.ageMs);

  console.log('--- Recent PM2 logs (last 30 mins) ---');
  for (const f of recentFiles) {
    const minutesAgo = (f.ageMs / 60000).toFixed(1);
    console.log(`Log: ${f.file} (${minutesAgo} mins ago, size: ${f.size} bytes)`);
    // Print the last 20 lines of the file
    const filePath = path.join(logsDir, f.file);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    console.log('-------------------------------------------');
    console.log(lines.slice(-20).join('\n'));
    console.log('===========================================\n');
  }
} catch (e) {
  console.error(e.message);
}
