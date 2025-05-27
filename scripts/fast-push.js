#!/usr/bin/env node

/**
 * Fast GitHub Push - Complete WhatsApp Web Library
 * Rapid upload of all files to GitHub repository
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const https = require('https');

const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const USER = 'gyovannyvpn123';
const REPO = 'Whatsapp-web-libraryy';
const EMAIL = 'mdanut159@gmail.com';

console.log('🚀 FAST GitHub Push - Complete Library Upload');
console.log('============================================');

async function api(endpoint, method = 'GET', data = null) {
  const options = {
    hostname: 'api.github.com',
    path: endpoint,
    method: method,
    headers: {
      'Authorization': `token ${TOKEN}`,
      'User-Agent': 'WhatsApp-Library-Fast',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: result });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function scanFiles() {
  const allFiles = [];
  
  async function scan(dir, base = dir) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    
    for (const item of items) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      
      const fullPath = path.join(dir, item.name);
      const relativePath = path.relative(base, fullPath).replace(/\\/g, '/');
      
      if (item.isDirectory()) {
        await scan(fullPath, base);
      } else {
        allFiles.push({ path: relativePath, fullPath });
      }
    }
  }
  
  await scan('/home/runner/workspace');
  return allFiles;
}

async function uploadFile(filePath, content) {
  try {
    const data = {
      message: `Upload ${filePath}`,
      content: Buffer.from(content).toString('base64'),
      committer: { name: 'WhatsApp Library', email: EMAIL },
      author: { name: 'WhatsApp Library', email: EMAIL }
    };
    
    const result = await api(`/repos/${USER}/${REPO}/contents/${filePath}`, 'PUT', data);
    
    if (result.status === 201 || result.status === 200) {
      return true;
    } else if (result.status === 409) {
      // File exists, update it
      const existing = await api(`/repos/${USER}/${REPO}/contents/${filePath}`);
      if (existing.status === 200) {
        data.sha = existing.data.sha;
        const updateResult = await api(`/repos/${USER}/${REPO}/contents/${filePath}`, 'PUT', data);
        return updateResult.status === 200;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`❌ ${filePath}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🔍 Scanning ALL files...');
  const files = await scanFiles();
  
  console.log(`📁 Total files found: ${files.length}`);
  console.log();
  
  // Critical files first
  const criticalFiles = [
    'src/index.js',
    'src/production-client.js', 
    'src/real-client.js',
    'src/websocket-real.js',
    'src/auth.js',
    'src/binary.js',
    'src/crypto.js',
    'src/session.js',
    'src/utils.js',
    'src/constants.js'
  ];
  
  let uploaded = 0;
  
  // Upload critical files first
  console.log('🎯 Uploading CRITICAL files first...');
  for (const criticalPath of criticalFiles) {
    const file = files.find(f => f.path === criticalPath);
    if (file) {
      console.log(`📤 CRITICAL: ${file.path}`);
      const content = await fs.readFile(file.fullPath, 'utf8');
      if (await uploadFile(file.path, content)) {
        uploaded++;
        console.log(`✅ UPLOADED: ${file.path}`);
      }
    }
  }
  
  // Upload remaining files
  console.log('\n📦 Uploading ALL remaining files...');
  for (const file of files) {
    if (criticalFiles.includes(file.path)) continue; // Skip already uploaded
    
    console.log(`📤 ${file.path}`);
    try {
      const content = await fs.readFile(file.fullPath, 'utf8');
      if (await uploadFile(file.path, content)) {
        uploaded++;
        console.log(`✅ ${file.path}`);
      }
    } catch (error) {
      console.error(`❌ ${file.path}: ${error.message}`);
    }
  }
  
  console.log('\n🎊 UPLOAD COMPLETE!');
  console.log(`✅ Successfully uploaded: ${uploaded}/${files.length} files`);
  console.log(`🔗 Repository: https://github.com/${USER}/${REPO}`);
  console.log('\n🚀 WhatsApp Web Library is now COMPLETELY on GitHub!');
}

main().catch(console.error);