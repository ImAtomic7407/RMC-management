const fs = require('fs');
const path = require('path');

const logsDir = 'C:\\Users\\sunny\\.pm2\\logs';
try {
  const file = 'exam-server-out-6.log';
  const filePath = path.join(logsDir, file);
  if (fs.existsSync(filePath)) {
    console.log(`Checking tail of ${file}...`);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    // Print the last 40 lines of the log file
    console.log('------------------------------------------------');
    console.log(lines.slice(-40).join('\n'));
    console.log('================================================');
  } else {
    console.log(`${file} does not exist.`);
  }
} catch (e) {
  console.error(e.message);
}
