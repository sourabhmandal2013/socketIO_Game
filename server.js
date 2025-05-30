const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, 'public')));

let MAX_TAPS;
const GAME_PIN = 'a689475';
const TEAMS = ['red', 'blue', 'green', 'yellow'];
const TEAM_COLORS = {
    red: '#e74c3c',
    blue: '#3498db',
    green: '#2ecc71',
    yellow: '#f1c40f'
};

let teams = {};
let gameOver = false;

function resetTeams() {
    teams = {};
    gameOver = true;
    TEAMS.forEach(team => {
        teams[team] = {
            members: [],
            score: 0,
            color: TEAM_COLORS[team]
        };
    });
}

resetTeams();

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
    return 'localhost';
}

const displayHost = getNetworkIP();

io.on('connection', (socket) => {
    console.log('New player connected or admin console loaded');

    const isClientPlayer = !socket.handshake.headers.referer || !socket.handshake.headers.referer.endsWith('index.html');

    if (isClientPlayer) {
        console.log(`Player client connected. Game over status: ${gameOver}`);

        if (!gameOver) {
            const assignedTeam = TEAMS.reduce((a, b) =>
                teams[a].members.length <= teams[b].members.length ? a : b
            );
            if (teams[assignedTeam]) {
                teams[assignedTeam].members.push(socket.id);
                socket.team = assignedTeam;
                socket.emit('assignedTeam', assignedTeam);
                socket.emit('gameStarted');
                io.emit('updateScores', teams); 
            }
        } else {
            console.log('Game not active. Player will wait for game to start.');
        }
    } else {
        socket.emit('requestPin');
    }
    
    io.emit('updateScores', teams);

    socket.on('startGame', (pin, newMaxTaps) => {
        if (pin === GAME_PIN) {
            const parsedTaps = parseInt(newMaxTaps);
            MAX_TAPS = isNaN(parsedTaps) || parsedTaps <= 0 ? 100 : parsedTaps;

            Object.keys(teams).forEach(team => {
                teams[team].score = 0;
            });
            gameOver = false;

            TEAMS.forEach(teamName => {
                teams[teamName].members = []; 
            });

            
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
            gameOver = true;
            announceWinner(socket.team);
        }
    });

    socket.on('resetGame', () => {
        console.log('Game reset requested');
        resetTeams();
        io.emit('updateScores', teams);
        io.emit('gameReset');
    });
    
    socket.on('requestTeam', () => {
        if (!gameOver) {
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
    console.log(`Server listening on port ${port}`);
    console.log(`Access at: http://${displayHost}:${port}/`);
    console.log(`Admin console typically at: http://${displayHost}:${port}/index.html`);
    console.log(`Player client page: http://${displayHost}:${port}/client.html`);
});