#!/bin/bash
# ============================================
# Cinepix Phone Server - One Command Setup
# ============================================
# Termux open koro, paste this entire script
# ============================================

set -e
cd ~

echo ""
echo "========================================="
echo "  Cinepix Phone Server Setup"
echo "========================================="
echo ""

# Install Node.js + Git
echo "[1/4] Installing Node.js + Git..."
pkg update -y > /dev/null 2>&1
pkg install -y nodejs git > /dev/null 2>&1

# Clone server
echo "[2/4] Downloading server..."
rm -rf ~/cinepix-server
git clone --depth 1 https://github.com/shanto100files/unused.git ~/cinepix-server > /dev/null 2>&1
cd ~/cinepix-server

# Install server dependencies
echo "[3/4] Installing dependencies..."
npm install > /dev/null 2>&1

# Clone + Build vega providers
echo "[4/4] Building providers (2-3 min)..."
git clone --depth 1 https://github.com/Zenda-Cross/vega-providers.git _providers > /dev/null 2>&1
cd _providers
npm install > /dev/null 2>&1
npm run build > /dev/null 2>&1
cd ..

# Create manager
cat > cinepix << 'EOF'
#!/bin/bash
D=~/cinepix-server
case "${1:-help}" in
  start)
    if [ -f "$D/server.pid" ] && kill -0 $(cat "$D/server.pid") 2>/dev/null; then
      echo "Running (PID: $(cat $D/server.pid))"
    else
      cd "$D"
      nohup node server.js >> "$D/server.log" 2>&1 &
      echo $! > "$D/server.pid"
      sleep 3
      curl -s http://localhost:3000/health && echo ""
    fi
    ;;
  stop)
    [ -f "$D/server.pid" ] && kill $(cat "$D/server.pid") 2>/dev/null && rm -f "$D/server.pid" && echo "Stopped" || echo "Not running"
    ;;
  restart) $0 stop; sleep 1; $0 start ;;
  status) curl -s http://localhost:3000/health 2>/dev/null || echo "Stopped" ;;
  logs) tail -20 "$D/server.log" 2>/dev/null ;;
  logf) tail -f "$D/server.log" ;;
  providers) curl -s http://localhost:3000/api/providers 2>/dev/null ;;
  tunnel) cloudflared tunnel --url http://localhost:3000 2>/dev/null || pkg install -y cloudflared && cloudflared tunnel --url http://localhost:3000 ;;
  *) echo "Usage: cinepix {start|stop|restart|status|logs|logf|providers|tunnel}" ;;
esac
EOF
chmod +x cinepix

# Boot service
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/cinepix.sh << 'EOF'
#!/bin/bash
termux-wake-lock
sleep 15
cd ~/cinepix-server
nohup node server.js >> server.log 2>&1 &
echo $! > server.pid
EOF
chmod +x ~/.termux/boot/cinepix.sh

# Alias
grep -q "alias cinepix=" ~/.bashrc 2>/dev/null || echo 'alias cinepix="bash ~/cinepix-server/cinepix"' >> ~/.bashrc

echo ""
echo "========================================="
echo "  DONE! Server Ready!"
echo "========================================="
echo ""
echo "Start:  cinepix start"
echo "Stop:   cinepix stop"
echo "Status: cinepix status"
echo "Logs:   cinepix logs"
echo ""
