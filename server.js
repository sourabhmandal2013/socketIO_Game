const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode'); // Your existing QR code library

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Game configuration
let MAX_TAPS;
const GAME_PIN = 'a689475';
const TEAMS = ['red', 'blue', 'green', 'yellow'];
const TEAM_COLORS = {
    red: '#e74c3c',
    blue: '#3498db',
    green: '#2ecc71',
    yellow: '#f1c40f'
};

// Game state
let teams = {};
let gameOver = false;

function resetTeams() {
    teams = {};
    gameOver = false;
    TEAMS.forEach(team => {
        teams[team] = {
            members: [],
            score: 0,
            color: TEAM_COLORS[team]
        };
    });
}

resetTeams();

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (let iface in interfaces) {
        for (let alias of interfaces[iface]) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '127.0.0.1'; // Fallback
}

const localIP = getLocalIP();

// ---- REMOVE OLD QR CODE FILE GENERATION ----
// const qrURL = `http://${localIP}:${port}/client.html`; // Use port variable
// QRCode.toFile('public/qr_code.png', qrURL, (err) => {
//  if (err) console.error("QR code error:", err);
//  else console.log('QR code generated for', qrURL);
// });
// ---- END REMOVAL ----

// ++++ ADD NEW API ENDPOINT FOR QR CODE DATA URL ++++
app.get('/api/qr-code', async (req, res) => {
    try {
        // Construct the URL that the QR code will point to.
        // This should be the URL for your player client page (client.html).
        // It uses the server's local IP and configured port.
        // For true "public URL" in production, you might need to use req.headers.host
        // or environment variables provided by your deployment platform.
        const hostname = "socket-io-game-khaki.vercel.app"
        const clientAccessURL = `http://${hostname}/client.html`;

        const dataUrl = await QRCode.toDataURL(clientAccessURL);
        res.json({ qrDataUrl: dataUrl }); // Send the Data URL as JSON
    } catch (err) {
        console.error("Failed to generate QR code data URL:", err);
        res.status(500).json({ error: "Failed to generate QR code" });
    }
});
// ++++ END NEW API ENDPOINT ++++

io.on('connection', (socket) => {
    console.log('New player connected or admin console loaded');

    // Assign team logic (primarily for players)
    if (!socket.handshake.headers.referer || !socket.handshake.headers.referer.endsWith('index.html')) { // Basic check if not admin
        const assignedTeam = TEAMS.reduce((a, b) =>
            teams[a].members.length <= teams[b].members.length ? a : b
        );
        if (teams[assignedTeam]) {
            teams[assignedTeam].members.push(socket.id);
            socket.team = assignedTeam;
            socket.emit('assignedTeam', assignedTeam);
        }
    }
    
    io.emit('updateScores', teams); // Update everyone
    
    // For admin console, 'requestPin' implies it's the admin page.
    // Or, you can have a specific event from admin to request initial data.
    // For now, 'requestPin' is used by the admin page.
    // The QR code itself is fetched via HTTP GET, not specifically tied to socket connection here.
    socket.emit('requestPin');


    socket.on('startGame', (pin, newMaxTaps) => {
        if (pin === GAME_PIN) {
            const parsedTaps = parseInt(newMaxTaps);
            MAX_TAPS = isNaN(parsedTaps) || parsedTaps <= 0 ? 100 : parsedTaps; // Corrected: ensure MAX_TAPS > 0

            Object.keys(teams).forEach(team => {
                teams[team].score = 0;
            });
            gameOver = false;

            io.emit('updateScores', teams);

            let countdown = 3;
            const countdownInterval = setInterval(() => {
                io.emit('countdown', countdown);
                countdown--;
                if (countdown < 0) {
                    clearInterval(countdownInterval);
                    io.emit('gameStarted');
                }
            }, 1000);
        } else {
            socket.emit('invalidPin');
        }
    });

    socket.on('tap', () => {
        if (gameOver || !socket.team || !teams[socket.team]) return;

        const team = teams[socket.team];
        team.score++;

        io.emit('updateScores', teams);

        if (MAX_TAPS && team.score >= MAX_TAPS) { // Check if MAX_TAPS is defined
            gameOver = true;
            announceWinner(socket.team);
        }
    });

    socket.on('resetGame', () => {
        console.log('Game reset requested');
        resetTeams();
        io.emit('updateScores', teams);
        io.emit('gameReset'); // This will trigger pinEntry display on admin
        // The admin console will fetch a new QR code if the page is reloaded or
        // if you implement a specific QR refresh logic.
    });
    
    // This 'requestTeam' seems to be for re-assigning or late joining players,
    // ensure it works correctly with your client-side logic.
    socket.on('requestTeam', () => {
        const assignedTeam = TEAMS.reduce((a, b) =>
            teams[a].members.length < teams[b].members.length ? a : b
        );
        if (teams[assignedTeam]) {
            teams[assignedTeam].members.push(socket.id);
            socket.team = assignedTeam;
            socket.emit('assignedTeam', assignedTeam);
            io.emit('updateScores', teams);
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Player disconnected');
        if (socket.team && teams[socket.team]) {
            teams[socket.team].members = teams[socket.team].members.filter(id => id !== socket.id);
            io.emit('updateScores', teams); // Update scores/player counts on disconnect
        }
    });
});

function announceWinner(winningTeam) {
    io.emit('gameOver', winningTeam);
}

server.listen(port, () => {
    console.log(`Server running at http://${localIP}:${port}`);
    console.log(`Admin console typically at: http://${localIP}:${port}/ or http://${localIP}:${port}/index.html`);
    console.log(`Player client page (for QR code): http://${localIP}:${port}/client.html`);
});