const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode'); // Assuming 'qrcode' is the correct package name based on 'grcode' typo

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Game configuration
let MAX_TAPS; // This variable was declared but not assigned a value.
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
            score: 0, // Changed from 8 to 0, as scores usually start at 0
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
    return '127.0.0.1';
}

const localIP = getLocalIP();
const qrURL = `http://${localIP}:3000/client.html`; // Corrected variable name from grURL

QRCode.toFile('public/qr_code.png', qrURL, (err) => {
    if (err) console.error("QR code error:", err); // Added colon for better readability
    else console.log('QR code generated for', qrURL); // Added comma for better readability
});

io.on('connection', (socket) => {
    console.log('New player connected');

    const assignedTeam = TEAMS.reduce((a, b) =>
        teams[a].members.length <= teams[b].members.length ? a : b
    );

    teams[assignedTeam].members.push(socket.id);
    socket.team = assignedTeam; // Assign team to socket

    socket.emit('assignedTeam', assignedTeam);
    io.emit('updateScores', teams);
    socket.emit('requestPin');

    socket.on('startGame', (pin, newMaxTaps) => { // Corrected startüame to startGame
        if (pin === GAME_PIN) { // Used strict equality
            const parsedTaps = parseInt(newMaxTaps);
            MAX_TAPS = isNaN(parsedTaps) || parsedTaps < 0 ? 100 : parsedTaps; // Set MAX_TAPS

            Object.keys(teams).forEach(team => {
                teams[team].score = 0;
            });
            gameOver = false; // Reset gameOver state

            io.emit('updateScores', teams);

            let countdown = 3;
            const countdownInterval = setInterval(() => {
                io.emit('countdown', countdown);
                countdown--;

                if (countdown < 0) { // Changed condition to countdown < 0 to account for 0
                    clearInterval(countdownInterval);
                    io.emit('gameStarted');
                }
            }, 1000);
        } else {
            socket.emit('invalidPin');
        }
    });

    socket.on('tap', () => {
        if (gameOver) return;

        const team = teams[socket.team]; // Get the team object
        team.score++; // Increment score

        io.emit('updateScores', teams);

        if (team.score >= MAX_TAPS) { // Used >= for consistency and to ensure win condition is met
            gameOver = true;
            announceWinner(socket.team); // Assuming announceWinner is defined elsewhere
        }
    });

    socket.on('resetGame', () => {
        console.log('Game reset requested');
        resetTeams();
        io.emit('updateScores', teams);
        io.emit('gameReset');
    });
    
    socket.on('requestTeam', () => {
        const assignedTeam = TEAMS.reduce((a, b) =>
            teams[a].members.length < teams[b].members.length ? a : b
        );
        teams[assignedTeam].members.push(socket.id);
        socket.team = assignedTeam;
        socket.emit('assignedTeam', assignedTeam);
        io.emit('updateScores', teams);
    });
    
    socket.on('disconnect', () => {
        console.log('Player disconnected');
        if (teams[socket.team]) {
            teams[socket.team].members = teams[socket.team].members.filter(id => id !== socket.id);
        }
    });
});

function announceWinner(winningTeam) {
    io.emit('gameOver', winningTeam);
}

server.listen(port, () => {
    console.log(`Server running at http://${localIP}:${port}`);
});