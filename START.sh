#!/bin/bash

echo ""
echo "==============================================================================="
echo "  🚀 CHAOS MESSENGER - QUICK START"
echo "==============================================================================="
echo ""

# Step 1: Start databases
echo "Step 1: Starting PostgreSQL and Redis with Docker..."
echo ""
cd backend
docker-compose -f docker-compose.dev.yml up -d
sleep 35
cd ..

# Step 2: Build backend
echo ""
echo "Step 2: Building Backend..."
echo ""
cd backend
mvn clean package
if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Backend build failed!"
    exit 1
fi

# Step 3: Start backend in new terminal/background
echo ""
echo "Step 3: Starting Backend..."
echo ""
java -jar target/chaos-messenger-*.jar &
BACKEND_PID=$!
sleep 5

# Step 4: Install and start frontend
echo ""
echo "Step 4: Installing Frontend dependencies..."
echo ""
cd ../frontend
npm install

echo ""
echo "Step 5: Starting Frontend..."
echo ""
npm run dev &
FRONTEND_PID=$!

echo ""
echo "==============================================================================="
echo "  ✅ SETUP COMPLETE!"
echo "==============================================================================="
echo ""
echo "Backend:  http://localhost:8080 (Swagger: /swagger-ui.html)"
echo "Frontend: http://localhost:5173"
echo ""
echo "Test account:"
echo "  Phone: +7999999999"
echo "  Code:  123456"
echo ""
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo ""
echo "Press Ctrl+C to stop"
echo ""

wait
