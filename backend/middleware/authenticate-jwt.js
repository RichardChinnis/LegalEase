// backend/middleware/authenticate-jwt.js
const jwt = require('jsonwebtoken');

const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token is missing or malformed.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const verifyOptions = {};
    if (process.env.JWT_ISSUER) verifyOptions.issuer = process.env.JWT_ISSUER;
    if (process.env.JWT_AUDIENCE) verifyOptions.audience = process.env.JWT_AUDIENCE;
    const decoded = jwt.verify(token, process.env.JWT_SECRET, verifyOptions);
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Authorization token has expired.' });
    }
    // For other errors like invalid signature
    return res.status(403).json({ error: 'Authorization token is invalid.' });
  }
};

module.exports = authenticateJWT;
