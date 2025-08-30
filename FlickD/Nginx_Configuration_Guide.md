# Nginx Configuration & Security Guide for FlickD

## 🚨 **CRITICAL: Current Security Issue**

**Your application is currently running without proper Nginx proxy configuration, causing WebSocket connection failures.**

### **Problem:**
- Nginx is not configured to proxy requests to your Node.js app (port 4000)
- WebSocket connections are failing
- API requests are not reaching your application
- Domain `api.justchit.chat` is not properly configured

---

## 🔧 **Immediate Fix Required**

### **Step 1: Create Nginx Proxy Configuration**

```bash
# Create proxy configuration file
sudo nano /etc/nginx/conf.d/api-proxy.conf
```

**Add this configuration:**
```nginx
server {
    listen 80;
    server_name api.justchit.chat;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # Hide Nginx version
    server_tokens off;

    # Proxy API requests to your Node.js app
    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Proxy WebSocket connections
    location /socket.io/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:4000/health;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### **Step 2: Test and Reload Nginx**

```bash
# Test configuration
sudo nginx -t

# Reload Nginx
sudo nginx -s reload
```

### **Step 3: Test Connection**

```bash
# Test API endpoint
curl http://localhost/api/health

# Test WebSocket endpoint
curl http://localhost/socket.io/
```

---

## 🔒 **Security Improvements (Required)**

### **Current Security Issues:**
1. ❌ No SSL/TLS (HTTPS) - All traffic unencrypted
2. ❌ No rate limiting - Vulnerable to DDoS
3. ❌ No authentication on Nginx level
4. ❌ No IP restrictions

### **Recommended Security Setup:**

#### **1. Add SSL/TLS Certificate**

```bash
# Install Certbot
sudo yum install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d api.justchit.chat
```

#### **2. Enhanced Secure Configuration**

```nginx
# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=websocket:10m rate=30r/s;

server {
    listen 80;
    server_name api.justchit.chat;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.justchit.chat;

    # SSL Configuration (Certbot will add this)
    ssl_certificate /etc/letsencrypt/live/api.justchit.chat/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.justchit.chat/privkey.pem;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    # Rate limiting for API
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Rate limiting for WebSocket
    location /socket.io/ {
        limit_req zone=websocket burst=50 nodelay;
        
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:4000/health;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Hide Nginx version
    server_tokens off;
}
```

---

## 🔧 **Application Configuration Updates**

### **Update CORS Settings**

In `FlickD/server/socket.js`:
```javascript
io = new Server(server, {
  cors: {
    origin: [
      "https://justchit.chat",
      "https://www.justchit.chat", 
      "https://api.justchit.chat"
    ],
    methods: ['GET', 'POST'],
    credentials: true
  }
});
```

### **Update API URL Configuration**

Ensure your app uses the correct API URL:
```javascript
// In your app configuration
API_URL: "https://api.justchit.chat/api"
```

---

## 🚀 **Deployment Checklist**

### **Before Deployment:**
- [ ] Nginx proxy configuration created
- [ ] SSL certificate obtained
- [ ] Security headers configured
- [ ] Rate limiting enabled
- [ ] CORS settings updated
- [ ] Domain DNS configured correctly

### **After Deployment:**
- [ ] Test API endpoints
- [ ] Test WebSocket connections
- [ ] Verify SSL certificate
- [ ] Check security headers
- [ ] Monitor rate limiting
- [ ] Test recording functionality

---

## 🔍 **Troubleshooting**

### **Common Issues:**

#### **1. WebSocket Connection Failed**
- Check Nginx proxy configuration
- Verify `/socket.io/` location block
- Check CORS settings

#### **2. API Requests Not Working**
- Verify `/api/` location block
- Check proxy_pass configuration
- Test direct connection to port 4000

#### **3. SSL Certificate Issues**
- Verify domain ownership
- Check DNS configuration
- Ensure port 443 is open

#### **4. Rate Limiting Too Strict**
- Adjust rate limits in configuration
- Monitor access logs for blocked requests

---

## 📊 **Monitoring & Maintenance**

### **Regular Tasks:**
- [ ] Monitor Nginx access logs
- [ ] Check SSL certificate expiration
- [ ] Review rate limiting effectiveness
- [ ] Update security headers as needed
- [ ] Monitor WebSocket connection stability

### **Log Locations:**
```bash
# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Application logs
pm2 logs flick-server
```

---

## ⚠️ **Security Warnings**

1. **Never expose your Node.js app directly** - Always use Nginx as a reverse proxy
2. **Always use HTTPS in production** - HTTP is insecure for API calls
3. **Implement rate limiting** - Protect against abuse and DDoS
4. **Keep SSL certificates updated** - Set up auto-renewal
5. **Monitor logs regularly** - Look for suspicious activity
6. **Update Nginx regularly** - Keep security patches current

---

## 📞 **Emergency Contacts**

If you encounter issues:
1. Check this guide first
2. Review Nginx error logs
3. Test configuration with `sudo nginx -t`
4. Check application logs with `pm2 logs`

---

**Last Updated:** July 2025
**Status:** URGENT - Configuration required for production deployment 