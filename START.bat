@echo off
echo.
echo ===============================================================================
echo  🚀 CHAOS MESSENGER - QUICK START
echo ===============================================================================
echo.
echo Step 1: Starting PostgreSQL and Redis with Docker...
echo.
cd backend
docker-compose -f docker-compose.dev.yml up -d
timeout /t 35 /nobreak
cd ..

echo.
echo Step 2: Building Backend...
echo.
cd backend
call mvn clean package
if errorlevel 1 goto error

echo.
echo Step 3: Starting Backend...
echo.
start cmd /k "java -jar target/chaos-messenger-*.jar"
timeout /t 5

echo.
echo Step 4: Installing Frontend dependencies...
echo.
cd ../frontend
call npm install

echo.
echo Step 5: Starting Frontend...
echo.
start cmd /k "npm run dev"

echo.
echo ===============================================================================
echo  ✅ SETUP COMPLETE!
echo ===============================================================================
echo.
echo Backend:  http://localhost:8080 (Swagger: /swagger-ui.html)
echo Frontend: http://localhost:5173
echo.
echo Test account:
echo   Phone: +7999999999
echo   Code:  123456
echo.
echo Press any key to close this window...
pause
goto end

:error
echo.
echo ❌ Backend build failed!
echo Check the error message above.
pause
:end
