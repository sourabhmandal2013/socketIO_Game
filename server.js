const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os'); // Re-import the os module

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 8080;
// We will determine the 'host' dynamically for console logging
// The server will listen on 0.0.0.0 by default when host is omitted in listen()

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
let gameOver = false; // This is the key flag to check if a game is running

function resetTeams() {
    teams = {};
    gameOver = true; // Set to true initially, no game is running
    TEAMS.forEach(team => {
        teams[team] = {
            members: [],
            score: 0,
            color: TEAM_COLORS[team]
        };
    });
}

resetTeams(); // Initialize teams and set gameOver to true

// Function to get the local non-loopback IPv4 address
function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const ifaceName in interfaces) {
        const iface = interfaces[ifaceName];
        for (const alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost'; // Fallback if no external IP is found
}

const displayHost = getNetworkIP(); // Get the IP for display purposes

io.on('connection', (socket) => {
    console.log('New player connected or admin console loaded');

    // Determine if it's an admin connection or a player connection based on referer
    const isClientPlayer = !socket.handshake.headers.referer || !socket.handshake.headers.referer.endsWith('index.html');

    if (isClientPlayer) {
        // This is a player client
        console.log(`Player client connected. Game over status: ${gameOver}`);

        if (!gameOver) { // If a game is currently running
            const assignedTeam = TEAMS.reduce((a, b) =>
                teams[a].members.length <= teams[b].members.length ? a : b
            );
            if (teams[assignedTeam]) {
                teams[assignedTeam].members.push(socket.id);
                socket.team = assignedTeam;
                socket.emit('assignedTeam', assignedTeam);
                // Immediately send gameStarted to this new player
                socket.emit('gameStarted');
                io.emit('updateScores', teams); // Update everyone
            }
        } else {
            // If game is not running, player stays in "Please Wait" state.
            console.log('Game not active. Player will wait for game to start.');
        }
    } else {
        // This is likely the admin console
        socket.emit('requestPin');
    }
    
    // For all connections, ensure they have the latest scores.
    io.emit('updateScores', teams);

    socket.on('startGame', (pin, newMaxTaps) => {
        if (pin === GAME_PIN) {
            const parsedTaps = parseInt(newMaxTaps);
            MAX_TAPS = isNaN(parsedTaps) || parsedTaps <= 0 ? 100 : parsedTaps;

            // Reset scores for all teams
            Object.keys(teams).forEach(team => {
                teams[team].score = 0;
            });
            gameOver = false; // Game is now running!

            // Ensure all players are re-assigned and updated
            TEAMS.forEach(teamName => {
                teams[teamName].members = []; // Clear old members
            });

            // Re-assign all *currently connected* players to balance teams
            io.sockets.sockets.forEach((s) => {
                if (!s.handshake.headers.referer || !s.handshake.headers.referer.endsWith('index.html')) {
                    const assignedTeam = TEAMS.reduce((a, b) =>
                        teams[a].members.length <= teams[b].members.length ? a : b
                    );
                    if (teams[assignedTeam]) {
                        teams[assignedTeam].members.push(s.id);
                        s.team = assignedTeam;
                        s.emit('assignedTeam', assignedTeam);
                    }
                }
            });

            io.emit('updateScores', teams);

            let countdown = 3;
            const countdownInterval = setInterval(() => {
                io.emit('countdown', countdown);
                countdown--;
                if (countdown < 0) {
                    clearInterval(countdownInterval);
                    io.emit('gameStarted');
                    io.emit('updateScores', teams);
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

        if (MAX_TAPS && team.score >= MAX_TAPS) {
            gameOver = true; // Game is over!
            announceWinner(socket.team);
        }
    });

    socket.on('resetGame', () => {
        console.log('Game reset requested');
        resetTeams(); // This sets gameOver back to true
        io.emit('updateScores', teams);
        io.emit('gameReset'); // This will trigger pinEntry display on admin
    });
    
    socket.on('requestTeam', () => {
        if (!gameOver) { // Only assign if game is running
            const assignedTeam = TEAMS.reduce((a, b) =>
                teams[a].members.length < teams[b].members.length ? a : b
            );
            if (teams[assignedTeam]) {
                if (socket.team && teams[socket.team]) {
                    teams[socket.team].members = teams[socket.team].members.filter(id => id !== socket.id);
                }
                teams[assignedTeam].members.push(socket.id);
                socket.team = assignedTeam;
                socket.emit('assignedTeam', assignedTeam);
                io.emit('updateScores', teams);
                socket.emit('gameStarted');
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Player disconnected');
        if (socket.team && teams[socket.team]) {
            teams[socket.team].members = teams[socket.team].members.filter(id => id !== socket.id);
            io.emit('updateScores', teams);
        }
    });
});

function announceWinner(winningTeam) {
    io.emit('gameOver', winningTeam);
}

server.listen(port, () => {
    // When host is omitted, listen defaults to 0.0.0.0 (all available IPv4 interfaces)
    // or :: (all available IPv6 interfaces)
    console.log(`Server listening on port ${port}`);
    console.log(`Access at: http://${displayHost}:${port}/`);
    console.log(`Admin console typically at: http://${displayHost}:${port}/index.html`);
    console.log(`Player client page: http://${displayHost}:${port}/client.html`);
});