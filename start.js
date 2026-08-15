#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */
const http = require('http');
const path = require('path');
const crypto = require('crypto');

process.env.INTERNAL_CRON_SECRET =
  process.env.INTERNAL_CRON_SECRET || crypto.randomBytes(32).toString('hex');

// 调用 generate-manifest.js 生成 manifest.json
function generateManifest() {
  console.log('Generating manifest.json for Docker deployment...');

  try {
    const generateManifestScript = path.join(
      __dirname,
      'scripts',
      'generate-manifest.js'
    );
    require(generateManifestScript);
  } catch (error) {
    console.error('❌ Error calling generate-manifest.js:', error);
    throw error;
  }
}

generateManifest();

// 直接在当前进程中启动 standalone Server（`server.js`）
require('./server.js');

let retryCount = 0;
const MAX_RETRIES = 60;
const rawHostname = process.env.HOSTNAME || 'localhost';
const pollHostname = rawHostname === '0.0.0.0' ? '127.0.0.1' : rawHostname;
const TARGET_URL = `http://${pollHostname}:${process.env.PORT || 3000}/api/server-config`;
const CRON_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

function checkServer() {
  console.log(
    `Fetching ${TARGET_URL} (attempt ${retryCount + 1}/${MAX_RETRIES}) ...`
  );
  let resolved = false;

  const req = http.get(TARGET_URL, (res) => {
    if (resolved) return;

    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      if (resolved) return;
      resolved = true;

      if (!(res.statusCode && res.statusCode >= 200 && res.statusCode < 300)) {
        handleFailure(new Error(`Bad status code: ${res.statusCode}`));
        return;
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        handleFailure(new Error('server-config returned invalid JSON'));
        return;
      }

      if (payload.StorageConfigured !== true) {
        handleFailure(
          new Error(
            `Storage not configured: ${payload.StorageMessage || 'unknown'}`
          )
        );
        return;
      }

      console.log('Server is up, storage is configured, stop polling.');

      setTimeout(() => {
        // 服务器启动后，立即执行一次 cron 任务
        executeCronJob();
      }, 3000);

      // 然后设置每小时执行一次 cron 任务
      setInterval(
        () => {
          executeCronJob();
        },
        60 * 60 * 1000
      ); // 每小时执行一次
    });
  });

  req.setTimeout(2000, () => {
    req.destroy();
  });

  req.on('error', (err) => {
    if (resolved) return;
    resolved = true;
    handleFailure(err);
  });
}

function handleFailure(err) {
  console.error(`Polling error: ${err.message}`);
  retryCount++;
  if (retryCount >= MAX_RETRIES) {
    console.error(
      `Failed to start server after ${MAX_RETRIES} attempts (${MAX_RETRIES}s timeout)`
    );
    process.exit(1);
  }
  setTimeout(checkServer, 1000);
}

// Start polling
checkServer();

// 执行 cron 任务的函数
function executeCronJob() {
  const rawHostname = process.env.HOSTNAME || 'localhost';
  const pollHostname = rawHostname === '0.0.0.0' ? '127.0.0.1' : rawHostname;
  const cronUrl = `http://${pollHostname}:${process.env.PORT || 3000}/api/cron?wait=true`;

  console.log(`Executing cron job: ${cronUrl}`);

  const cronSecret =
    process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;
  const req = http.get(
    cronUrl,
    {
      headers: {
        Authorization: `Bearer ${cronSecret}`,
      },
    },
    (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          console.log('Cron job executed successfully:', data);
        } else {
          console.error('Cron job failed:', res.statusCode, data);
        }
      });
    }
  );

  req.on('error', (err) => {
    console.error('Error executing cron job:', err);
  });

  req.setTimeout(CRON_REQUEST_TIMEOUT_MS, () => {
    console.error(`Cron job timeout after ${CRON_REQUEST_TIMEOUT_MS / 1000}s`);
    req.destroy();
  });
}
