const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
// const os = require('os'); // Removed os module as it's no longer needed for IP detection

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 8080;
const host = '127.0.0.1'; // Explicitly set host to localhost

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

// Removed getLocalIP function as we're now explicitly using 127.0.0.1

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

server.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}`);
    console.log(`Admin console typically at: http://${host}:${port}/ or http://${host}:${port}/index.html`);
    console.log(`Player client page: http://${host}:${port}/client.html`);
});