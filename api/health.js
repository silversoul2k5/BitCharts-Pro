'use strict';

const { buildHealthPayload, sendJson } = require('../server');

module.exports = async function healthHandler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  sendJson(res, 200, buildHealthPayload());
};
