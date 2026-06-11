const { db } = require('./db');
const users = db.prepare('SELECT id, username, role, email, phone, subscription_status FROM users').all();
console.log('--- USERS IN DATABASE ---');
console.log(JSON.stringify(users, null, 2));
