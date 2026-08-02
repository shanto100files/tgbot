#!/bin/bash
# ============================================
# Cinepix Phone Server - Complete Setup
# ============================================
# Termux open koro, then:
# bash setup-phone.sh
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SERVER_DIR=~/cinepix-server
REPO_URL="https://github.com/shanto100files/unused.git"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Cinepix Phone Server - Full Setup       ║${NC}"
echo -e "${BLUE}║  Providers + Server + Background         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# Step 1: System update
echo -e "${YELLOW}[1/8]${NC} Updating system..."
pkg update -y -o DPkg::options::="--force-confnew" > /dev/null 2>&1 || true

# Step 2: Install Node.js, Git
echo -e "${YELLOW}[2/8]${NC} Installing Node.js and Git..."
pkg install -y nodejs git > /dev/null 2>&1 || true

# Step 3: Install cloudflared (for public URL)
echo -e "${YELLOW}[3/8]${NC} Installing cloudflared..."
pkg install -y cloudflared > /dev/null 2>&1 || true

# Step 4: Clone repo
echo -e "${YELLOW}[4/8]${NC} Downloading server..."
rm -rf "$SERVER_DIR"
git clone --depth 1 "$REPO_URL" "$SERVER_DIR" 2>/dev/null || true
cd "$SERVER_DIR"

# Step 5: Install server dependencies
echo -e "${YELLOW}[5/8]${NC} Installing server dependencies..."
npm install 2>/dev/null || true

# Step 6: Clone and build vega providers
echo -e "${YELLOW}[6/8]${NC} Setting up Vega providers..."
echo "  Cloning vega-providers..."
rm -rf _providers
git clone --depth 1 https://github.com/Zenda-Cross/vega-providers.git _providers 2>/dev/null || true

echo "  Installing provider dependencies..."
cd _providers
npm install 2>/dev/null || true

echo "  Building providers (may take 2-3 minutes)..."
npm run build 2>/dev/null || true
cd "$SERVER_DIR"

# Step 7: Create manager script
echo -e "${YELLOW}[7/8]${NC} Creating manager..."
cat > cinepix << 'EOF'
#!/bin/bash
DIR=~/cinepix-server
PID="$DIR/server.pid"
LOG="$DIR/server.log"

case "${1:-help}" in
  start)
    if [ -f "$PID" ] && kill -0 $(cat "$PID") 2>/dev/null; then
      echo "Already running (PID: $(cat $PID))"
    else
      cd "$DIR"
      nohup node server.js >> "$LOG" 2>&1 &
      echo $! > "$PID"
      sleep 3
      if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo "Server started! (PID: $(cat $PID))"
        curl -s http://localhost:3000/health
      else
        echo "Starting... (check: cinepix logs)"
      fi
    fi
    ;;
  stop)
    if [ -f "$PID" ]; then
      kill $(cat "$PID") 2>/dev/null
      rm -f "$PID"
      echo "Stopped"
    else
      echo "Not running"
    fi
    ;;
  restart) $0 stop; sleep 1; $0 start ;;
  status)
    if [ -f "$PID" ] && kill -0 $(cat "$PID") 2>/dev/null; then
      echo "Running (PID: $(cat $PID))"
      curl -s http://localhost:3000/health 2>/dev/null && echo ""
    else
      echo "Stopped"
    fi
    ;;
  logs) tail -20 "$LOG" 2>/dev/null || echo "No logs" ;;
  logf) tail -f "$LOG" ;;
  providers) curl -s http://localhost:3000/api/providers 2>/dev/null | head -c 500 ;;
  tunnel)
    echo "Starting cloudflared tunnel..."
    cloudflared tunnel --url http://localhost:3000
    ;;
  *)
    echo "Cinepix Server Manager"
    echo ""
    echo "Usage: cinepix <command>"
    echo ""
    echo "Commands:"
    echo "  start      - Start server in background"
    echo "  stop       - Stop server"
    echo "  restart    - Restart server"
    echo "  status     - Check server status"
    echo "  logs       - Show last 20 log lines"
    echo "  logf       - Follow logs (live)"
    echo "  providers  - List loaded providers"
    echo "  tunnel     - Start public URL tunnel"
    ;;
esac
EOF
chmod +x cinepix

# Step 8: Boot service
echo -e "${YELLOW}[8/8]${NC} Setting up auto-start..."
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
cat > "$BOOT_DIR/cinepix.sh" << 'BOOTEOF'
#!/bin/bash
termux-wake-lock
sleep 15
cd ~/cinepix-server
nohup node server.js >> server.log 2>&1 &
echo $! > server.pid
BOOTEOF
chmod +x "$BOOT_DIR/cinepix.sh"

# Create aliases
if ! grep -q "alias cinepix=" "$HOME/.bashrc" 2>/dev/null; then
  echo "" >> "$HOME/.bashrc"
  echo "# Cinepix Server" >> "$HOME/.bashrc"
  echo "alias cinepix='bash ~/cinepix-server/cinepix'" >> "$HOME/.bashrc"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        Setup Complete!                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "Quick Start:"
echo -e "  ${GREEN}cinepix start${NC}"
echo ""
echo -e "All Commands:"
echo -e "  ${BLUE}cinepix start${NC}      - Start server"
echo -e "  ${BLUE}cinepix stop${NC}       - Stop server"
echo -e "  ${BLUE}cinepix restart${NC}    - Restart server"
echo -e "  ${BLUE}cinepix status${NC}     - Check status"
echo -e "  ${BLUE}cinepix logs${NC}       - View logs"
echo -e "  ${BLUE}cinepix logf${NC}       - Follow logs"
echo -e "  ${BLUE}cinepix providers${NC}  - List providers"
echo -e "  ${BLUE}cinepix tunnel${NC}     - Public URL"
echo ""
echo -e "Public URL:"
echo -e "  ${YELLOW}cinepix tunnel${NC}"
echo ""
echo -e "Auto-start on boot: ${GREEN}Enabled${NC}"
echo -e "(Requires Termux:Boot app from F-Droid)"
echo ""
echo -e "Test:"
echo -e "  ${GREEN}cinepix start${NC}"
echo -e "  curl http://localhost:3000/health"
echo ""
