const http = require('http');

const options = {
  hostname: 'localhost',
  port: 8080,
  path: '/api/internal/exam/roster',
  method: 'GET',
  headers: {
    'x-exam-secret': process.env.EXAM_INTERNAL_SECRET || 'your-secret-here'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const payload = JSON.parse(data);
      console.log('RMC Roster response status:', res.statusCode);
      if (payload.students) {
        console.log('Total students synced on RMC:', payload.students.length);
        const matching = payload.students.filter(s =>
          s.full_name.toLowerCase().includes('satyam') ||
          s.full_name.toLowerCase().includes('stayam') ||
          s.student_uid.toLowerCase().includes('satyam') ||
          s.student_uid.toLowerCase().includes('stayam')
        );
        console.log('Matching students on RMC:', matching);
      } else {
        console.log(payload);
      }
    } catch (err) {
      console.error('Failed to parse JSON:', err);
      console.log('Raw data:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('Request error:', err);
});

req.end();
