#!/usr/bin/env node

/**
 * GitHub Push Script - WhatsApp Web Library
 * Uploads entire library to GitHub repository
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const GITHUB_USER = 'gyovannyvpn123';
const GITHUB_REPO = 'Whatsapp-web-libraryy';
const GITHUB_EMAIL = 'mdanut159@gmail.com';

console.log('🚀 GitHub Push - WhatsApp Web Library');
console.log('====================================');
console.log(`📦 Target: ${GITHUB_USER}/${GITHUB_REPO}`);
console.log();

async function githubAPI(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'WhatsApp-Web-Library',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            reject(new Error(`${res.statusCode}: ${result.message}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function getFiles(dir, base = dir) {
  const files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    if (item.name.startsWith('.') || item.name === 'node_modules') continue;
    
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(base, fullPath).replace(/\\/g, '/');
    
    if (item.isDirectory()) {
      files.push(...await getFiles(fullPath, base));
    } else {
      files.push({ path: relativePath, fullPath });
    }
  }
  return files;
}

async function uploadFile(filePath, content) {
  try {
    let sha = null;
    try {
      const existing = await githubAPI(`/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${filePath}`);
      sha = existing.sha;
    } catch (e) {
      // File doesn't exist
    }
    
    const data = {
      message: `Add ${filePath}`,
      content: Buffer.from(content).toString('base64'),
      committer: { name: 'Library Bot', email: GITHUB_EMAIL },
      author: { name: 'Library Bot', email: GITHUB_EMAIL }
    };
    
    if (sha) data.sha = sha;
    
    await githubAPI(`/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${filePath}`, 'PUT', data);
    return true;
  } catch (error) {
    console.error(`❌ ${filePath}: ${error.message}`);
    return false;
  }
}

async function main() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GITHUB_PERSONAL_ACCESS_TOKEN not found');
    process.exit(1);
  }
  
  try {
    console.log('🔍 Scanning files...');
    const files = await getFiles('/home/runner/workspace');
    console.log(`📁 Found ${files.length} files`);
    console.log();
    
    let success = 0, failed = 0;
    
    for (const file of files) {
      console.log(`📤 ${file.path}`);
      const content = await fs.readFile(file.fullPath, 'utf8');
      
      if (await uploadFile(file.path, content)) {
        success++;
        console.log(`✅ ${file.path}`);
      } else {
        failed++;
      }
      
      await new Promise(r => setTimeout(r, 100)); // Rate limit
    }
    
    console.log();
    console.log('📊 Results:');
    console.log(`✅ Uploaded: ${success}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📦 Total: ${files.length}`);
    console.log();
    console.log('🎉 WhatsApp Web Library pushed to GitHub!');
    console.log(`🔗 https://github.com/${GITHUB_USER}/${GITHUB_REPO}`);
    
  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  }
}

main();