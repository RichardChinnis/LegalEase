// frontend/js/auth-service.js

class AuthService {
  constructor() {
    this.token = this.getToken();
    this.user = this.getUserFromToken();
  }

  isLoggedIn() {
    return !!this.token;
  }

  getToken() {
    return localStorage.getItem('authToken');
  }

  getUserFromToken() {
    if (!this.token) {
      return null;
    }
    try {
      // The token is in three parts: header, payload, signature
      const payload = JSON.parse(atob(this.token.split('.')[1]));
      return payload;
    } catch (e) {
      console.error('Error decoding token:', e);
      this.logout(); // If token is malformed, log out
      return null;
    }
  }

  async register(email, password) {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Registration failed.');
      }
      return data;
    } catch (error) {
      console.error('Registration error for email:', email, error);
      throw error;
    }
  }

  async login(email, password) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Login failed.');
      }
      
      if (data.token) {
        localStorage.setItem('authToken', data.token);
        this.token = data.token;
        this.user = this.getUserFromToken();
      }
      return data;
    } catch (error) {
      console.error('Login error for email:', email, error);
      throw error;
    }
  }

  logout() {
    localStorage.removeItem('authToken');
    this.token = null;
    this.user = null;
    // Redirect to login page to prevent access to authenticated areas
    window.location.href = '/auth.html';
  }
}

// Export a singleton instance
const authService = new AuthService();
