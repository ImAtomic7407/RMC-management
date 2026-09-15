const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port: 4200, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port: 4200, path, method: 'GET',
        headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function test(uid) {
  console.log(`Testing login for student UID: ${uid}`);
  const loginRes = await post('/api/auth/login/rmc/student', { uid });
  if (loginRes.status === 'success' && loginRes.access_token) {
    console.log('Login success!');
    console.log('User details:', loginRes.user);
    const token = loginRes.access_token;
    const examsRes = await get('/api/student/exams', token);
    console.log('Exams visible to student:');
    if (examsRes.exams) {
      console.log(examsRes.exams.map(e => ({ id: e.id, title: e.title, status: e.status, attemptStatus: e.attempt?.status })));
    } else {
      console.log(examsRes);
    }
  } else {
    console.log('Login failed:', loginRes);
  }
}

async function main() {
  await test('RMC-JEE-1616-SATYAMKU');
}

main().catch(console.error);
