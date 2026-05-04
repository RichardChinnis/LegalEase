// backend/tests/middleware.test.js
const jwt = require('jsonwebtoken');
const authenticateJWT = require('../middleware/authenticate-jwt');

// Mock Express req, res, and next objects for testing
const mockRequest = (headers) => ({
  headers: headers || {},
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

describe('authenticateJWT Middleware', () => {
  const JWT_SECRET = process.env.JWT_SECRET;
  const userPayload = { userId: 1, email: 'test@example.com' };

  // Clear mock history before each test
  beforeEach(() => {
    mockNext.mockClear();
  });

  it('should call next() and attach user to req if token is valid', () => {
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' });
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const res = mockResponse();

    authenticateJWT(req, res, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe(userPayload.userId);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 if authorization header is missing', () => {
    const req = mockRequest();
    const res = mockResponse();

    authenticateJWT(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authorization token is missing or malformed.' });
  });

  it('should return 401 if header is malformed (not Bearer)', () => {
    const token = jwt.sign(userPayload, JWT_SECRET);
    const req = mockRequest({ authorization: token }); // Missing "Bearer "
    const res = mockResponse();

    authenticateJWT(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authorization token is missing or malformed.' });
  });

  it('should return 401 if token is expired', () => {
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '-1s' }); // Expired token
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const res = mockResponse();

    authenticateJWT(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authorization token has expired.' });
  });

  it('should return 403 if token signature is invalid', () => {
    const token = jwt.sign(userPayload, 'a-different-secret'); // Signed with wrong secret
    const req = mockRequest({ authorization: `Bearer ${token}` });
    const res = mockResponse();

    authenticateJWT(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authorization token is invalid.' });
  });
});
