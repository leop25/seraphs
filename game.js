console.log('Iniciando Seraph\'s Arena...');

// Simple Web Audio API for sound effects
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playSound(frequency, duration, type = 'sine') {
    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = type;
        
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
    } catch(e) {
        // Ignore audio errors
    }
}

// Game Configuration
const CONFIG = {
    CANVAS_WIDTH: 1280,
    CANVAS_HEIGHT: 720,
    PLAYER_SPEED: 3.5,
    BULLET_SPEED: 2,
    ENEMY_SPEED: 1.2,
    GRAVITY: 0.6,
    JUMP_FORCE: -12,
    GROUND_HEIGHT: 150,
    PLATFORM_HEIGHT: 40,
    WAVE_SPAWN_RATE: 90,
    // Performance optimizations
    MAX_BULLETS: 60,
    MAX_ENEMIES: 20,
    MAX_TRAIL_LENGTH: 5,
    BULLET_CLEANUP_THRESHOLD: 80
};

// Game State
let gameState = {
    running: false,
    paused: false,
    wave: 1,
    score: 0,
    souls: 0,
    // Wave System
    waveStartTime: 0,
    waveDuration: 60000, // 60 seconds per wave
    enemiesInWave: 0,
    enemiesKilled: 0,
    enemySpawnRate: 800, // milliseconds between spawns
    lastEnemySpawn: 0,
    maxEnemiesThisWave: 1, // Maximum enemies for current wave
    enemiesSpawnedThisWave: 0, // Counter for enemies spawned in current wave
    // Selection
    selectedStaff: null,
    selectedHat: null,
    ownedCards: [], // Array para armazenar cartas compradas com níveis
    lastTime: 0, // For delta time calculation
    gameTime: 0, // Total game time in milliseconds
    // Ranking
    scoreSubmitted: false, // Flag para prevenir envios múltiplos
    environmentEffects: {
        lightning: { active: false, level: 0, lastTrigger: 0 },
        meteor: { active: false, level: 0, lastTrigger: 0 },
        thorns: { active: false, level: 0, lastTrigger: 0 },
        poison: { active: false, level: 0, lastTrigger: 0 },
        fire: { active: false, level: 0, lastTrigger: 0 }
    },
    playerStats: {
        health: 120,
        maxHealth: 120,
        damage: 40, // Aumentado de 25 para 40
        speed: CONFIG.PLAYER_SPEED,
        fireRate: 1000, // milliseconds between shots
        multishot: 1,
        lifesteal: 0,
        damageReduction: 0,
        explosive: false,
        piercing: false
    }
};

// Input handling
const keys = {};
const mouse = { x: 0, y: 0, clicked: false };

// Get canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// Game entities
let player, bullets, enemies, effects, particles = [];

// Game entities (platforms removed)

// Classes
class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 18; // Hitbox um pouco menor para melhor precisão
        this.height = 22;
        this.vx = 0;
        this.vy = 0;
        this.health = gameState.playerStats.health;
        this.maxHealth = gameState.playerStats.maxHealth;
        this.lastShot = 0;
        this.onGround = false;
        this.facingRight = true;
    }

    update(deltaTime, gameTime) {
        // Horizontal movement
        if (keys['ArrowLeft'] || keys['a']) {
            this.vx = -gameState.playerStats.speed;
            this.facingRight = false;
        } else if (keys['ArrowRight'] || keys['d']) {
            this.vx = gameState.playerStats.speed;
            this.facingRight = true;
        } else {
            this.vx *= 0.8; // Friction
        }

        // Jumping
        if ((keys['ArrowUp'] || keys['w'] || keys[' ']) && this.onGround) {
            this.vy = CONFIG.JUMP_FORCE;
            this.onGround = false;
        }

        // Apply gravity
        this.vy += CONFIG.GRAVITY;

        // Update position
        this.x += this.vx;
        this.y += this.vy;

        // Boundary checking
        this.x = Math.max(this.width/2, Math.min(CONFIG.CANVAS_WIDTH - this.width/2, this.x));

        // Terrain collision - check actual terrain height
        this.onGround = false;
        const terrainHeight = getTerrainHeightAt(this.x);
        if (this.y + this.height/2 >= terrainHeight) {
            this.y = terrainHeight - this.height/2;
            this.vy = 0;
            this.onGround = true;
        }
        
        // Manual aim with mouse (using game time instead of frame count)
        if (mouse.clicked && gameTime - this.lastShot > gameState.playerStats.fireRate) {
            this.shoot();
            this.lastShot = gameTime;
        }
    }

    shoot() {
        // Calculate angle to mouse position
        const rect = canvas.getBoundingClientRect();
        const mouseX = mouse.x * (CONFIG.CANVAS_WIDTH / rect.width);
        const mouseY = mouse.y * (CONFIG.CANVAS_HEIGHT / rect.height);
        
        const baseAngle = Math.atan2(mouseY - this.y, mouseX - this.x);
        const startX = this.x;
        const startY = this.y - this.height/4; // Shoot from upper body
        
        const createBullet = (angle, damage, color, isHoming = false) => {
            let bullet;
            
            // Check for ricochet bullets first
            if (gameState.playerStats.ricochet) {
                bullet = new RicochetBullet(startX, startY, angle, damage, color);
                bullet.maxRicochets = 3 + (gameState.playerStats.ricochetLevel || 0);
            } else if (isHoming && gameState.playerStats.explosive) {
                // Homing + Explosive = Explosive Homing Bullet (special case)
                bullet = new HomingBullet(startX, startY, angle, damage, color);
                bullet.explosive = true; // Mark for explosion on impact
            } else if (isHoming) {
                bullet = new HomingBullet(startX, startY, angle, damage, color);
            } else if (gameState.playerStats.explosive) {
                bullet = new ExplosiveBullet(startX, startY, angle, damage, color);
            } else {
                bullet = new Bullet(startX, startY, angle, damage, color);
            }
            if (gameState.playerStats.piercing) bullet.piercing = true;
            return bullet;
        };

        const staffs = {
            wizard: () => {
                const color = gameState.playerStats.explosive ? '#ff4444' : '#44aaff';
                for (let i = 0; i < gameState.playerStats.multishot; i++) {
                    const spread = (i - (gameState.playerStats.multishot - 1) / 2) * 0.1;
                    bullets.push(createBullet(baseAngle + spread, gameState.playerStats.damage, color));
                }
            },
            emerald: () => {
                const color = gameState.playerStats.explosive ? '#ff4444' : '#44ff44';
                for (let i = 0; i < gameState.playerStats.multishot; i++) {
                    const spread = (i - (gameState.playerStats.multishot - 1) / 2) * 0.1;
                    bullets.push(createBullet(baseAngle + spread, gameState.playerStats.damage * 0.85, color, true));
                }
            },
            trident: () => {
                const color = gameState.playerStats.explosive ? '#ff4444' : '#ffaa44';
                // Base 3 shots + multishot bonus
                const totalShots = 3 + (gameState.playerStats.multishot - 1);
                for (let i = 0; i < totalShots; i++) {
                    const spread = (i - (totalShots - 1) / 2) * 0.15;
                    bullets.push(createBullet(baseAngle + spread, gameState.playerStats.damage * 0.75, color));
                }
            },
            boom: () => {
                // Boom staff is always explosive (inherent + card explosive stacks)
                for (let i = 0; i < gameState.playerStats.multishot; i++) {
                    const spread = (i - (gameState.playerStats.multishot - 1) / 2) * 0.1;
                    const bullet = new ExplosiveBullet(startX, startY, baseAngle + spread, gameState.playerStats.damage * 1.3, '#ff4444');
                    if (gameState.playerStats.piercing) bullet.piercing = true;
                    bullets.push(bullet);
                }
            }
        };

        if (staffs[gameState.selectedStaff]) {
            staffs[gameState.selectedStaff]();
            
            // Play shoot sound
            playSound(800, 0.1, 'square');
        }
    }

    takeDamage(amount) {
        const reduced = amount * (1 - (gameState.playerStats.damageReduction || 0));
        this.health -= reduced;
        
        // Play damage sound
        playSound(200, 0.2, 'sawtooth');
        if (this.health <= 0) {
            this.health = 0;
            endGame();
        }
        updateUI();
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        
        // Player body (robe) - pure black
        ctx.fillStyle = '#000000';
        ctx.fillRect(-this.width/2, -this.height/2, this.width, this.height);
        
        // Robe details (white lines/patterns)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-this.width/2 + 2, -this.height/2, 1, this.height);
        ctx.fillRect(this.width/2 - 3, -this.height/2, 1, this.height);
        // Horizontal robe details
        ctx.fillRect(-this.width/2, -this.height/2 + 6, this.width, 1);
        ctx.fillRect(-this.width/2, -this.height/2 + 12, this.width, 1);
        ctx.fillRect(-this.width/2, -this.height/2 + 18, this.width, 1);
        
        // Player head (pure white)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-6, -this.height/2 - 6, 12, 10);
        
        // Hat (black with white details)
        ctx.fillStyle = '#000000';
        ctx.fillRect(-8, -this.height/2 - 12, 16, 8);
        ctx.fillRect(-4, -this.height/2 - 16, 8, 6);
        
        // Hat details (white lines and patterns)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-8, -this.height/2 - 12, 16, 1);
        ctx.fillRect(-8, -this.height/2 - 8, 16, 1);
        ctx.fillRect(-4, -this.height/2 - 16, 8, 1);
        // Hat side details
        ctx.fillRect(-8, -this.height/2 - 11, 1, 6);
        ctx.fillRect(7, -this.height/2 - 11, 1, 6);
        
        // Staff (black with white details)
        ctx.fillStyle = '#000000';
        const staffX = this.facingRight ? this.width/2 - 2 : -this.width/2 - 2;
        ctx.fillRect(staffX, -this.height/2, 4, this.height);
        
        // Staff details (white lines)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(staffX, -this.height/2, 1, this.height);
        ctx.fillRect(staffX + 3, -this.height/2, 1, this.height);
        
        // Staff orb (white with black center)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(staffX, -this.height/2 - 4, 4, 4);
        ctx.fillStyle = '#000000';
        ctx.fillRect(staffX + 1, -this.height/2 - 3, 2, 2);
        
        // Eyes (black)
        ctx.fillStyle = '#000000';
        ctx.fillRect(-4, -this.height/2 - 4, 2, 2);
        ctx.fillRect(2, -this.height/2 - 4, 2, 2);
        
        // Facial features (nose)
        ctx.fillStyle = '#000000';
        ctx.fillRect(-1, -this.height/2 - 2, 2, 1);
        
        ctx.restore();
    }
}

class Bullet {
    constructor(x, y, angle, damage, color = '#ffffff') {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.speed = CONFIG.BULLET_SPEED;
        this.damage = damage;
        this.color = color;
        this.width = 8; // Hitbox mais generoso
        this.height = 8; 
        this.visualWidth = 7; // Tamanho visual maior
        this.visualHeight = 7;
        this.lifetime = 600; 
        this.piercing = false;
        this.trail = [];
    }

    update() {
        // Optimized trail - shorter and less frequent
        if (this.lifetime % 2 === 0) { // Only add trail every other frame
            this.trail.push({x: this.x, y: this.y});
            if(this.trail.length > CONFIG.MAX_TRAIL_LENGTH) this.trail.shift();
            
            // Add trail particles
            if (Math.random() < 0.3) {
                createTrailParticles(this.x, this.y, this.color, 'normal');
            }
        }
        
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        this.lifetime--;

        // Optimized bounds checking
        if (this.x < -50 || this.x > CONFIG.CANVAS_WIDTH + 50 || 
            this.y < -50 || this.y > CONFIG.CANVAS_HEIGHT + 50 || 
            this.lifetime <= 0) {
            return false;
        }
        
        // Optimized collision detection - early exit
        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            if (this.checkCollision(enemy)) {
                enemy.takeDamage(this.damage);
                if (enemy.health <= 0) {
                    enemy.killed = true; // Mark for removal instead of immediate splice
                    gameState.enemiesKilled++;
                    gameState.score += 10;
                    
                    // Explosive death effect
                    if (gameState.playerStats.explosiveDeath) {
                        const miniTiros = 5 + (gameState.playerStats.explosiveDeathLevel || 0);
                        for (let i = 0; i < miniTiros; i++) {
                            const angle = (Math.PI * 2 / miniTiros) * i;
                            const miniBullet = new ExplosiveDeathBullet(enemy.x, enemy.y, angle, this.damage, '#ffaa44');
                            bullets.push(miniBullet);
                        }
                    }
                    
                    // Give XP for kill
                    // giveXP(15 + Math.floor(gameState.wave * 2)); // More XP in later waves
                    
                    // Lifesteal
                    if (gameState.playerStats.lifesteal > 0) {
                        player.health = Math.min(player.health + gameState.playerStats.lifesteal, gameState.playerStats.maxHealth);
                    }
                }
                if (!this.piercing) return false;
            }
        }
        return true;
    }

    draw() {
        ctx.save();
        
        // Enhanced trail with fade effect
        if (this.trail.length > 1) {
            for (let i = 0; i < this.trail.length - 1; i++) {
                const alpha = (i / this.trail.length) * 0.8;
                const width = (i / this.trail.length) * 4 + 1;
                
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = width;
                
                ctx.beginPath();
                ctx.moveTo(this.trail[i].x, this.trail[i].y);
                ctx.lineTo(this.trail[i + 1].x, this.trail[i + 1].y);
                ctx.stroke();
            }
            
            // Glowing trail effect
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 6;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 8;
            
            ctx.beginPath();
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Enhanced bullet body with glow
        ctx.globalAlpha = 1;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10;
        
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.visualWidth/2, this.y - this.visualHeight/2, 
                    this.visualWidth, this.visualHeight);
        
        // Bright white core with glow
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 5;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
        
        ctx.restore();
    }

    checkCollision(enemy) {
        // Optimized distance-based collision check first
        const dx = this.x - enemy.x;
        const dy = this.y - enemy.y;
        const distance = dx * dx + dy * dy; // Skip sqrt for performance
        const maxDistance = (this.width + enemy.width) * (this.width + enemy.width) / 4;
        
        if (distance > maxDistance) return false;
        
        // More precise AABB check only if distance check passes
        return this.x - this.width/2 < enemy.x + enemy.width/2 &&
               this.x + this.width/2 > enemy.x - enemy.width/2 &&
               this.y - this.height/2 < enemy.y + enemy.height/2 &&
               this.y + this.height/2 > enemy.y - enemy.height/2;
    }
}

class HomingBullet extends Bullet {
    constructor(x, y, angle, damage, color) {
        super(x, y, angle, damage, color);
        this.turnSpeed = 0.1;
        this.visualWidth = 8; // Larger visual for homing bullets
        this.visualHeight = 8;
        this.spiralOffset = 0;
    }

    draw() {
        ctx.save();
        
        // Spiral trail effect for homing bullets
        if (this.trail.length > 1) {
            for (let i = 0; i < this.trail.length - 1; i++) {
                const alpha = (i / this.trail.length) * 0.9;
                const width = (i / this.trail.length) * 5 + 2;
                
                // Create spiral effect
                const spiralRadius = Math.sin(i * 0.3 + this.spiralOffset) * 3;
                const perpAngle = Math.atan2(this.trail[i + 1].y - this.trail[i].y, 
                                           this.trail[i + 1].x - this.trail[i].x) + Math.PI / 2;
                
                const spiralX = this.trail[i].x + Math.cos(perpAngle) * spiralRadius;
                const spiralY = this.trail[i].y + Math.sin(perpAngle) * spiralRadius;
                
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = width;
                
                ctx.beginPath();
                ctx.moveTo(spiralX, spiralY);
                ctx.lineTo(this.trail[i + 1].x, this.trail[i + 1].y);
                ctx.stroke();
            }
            
            // Bright center trail
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 12;
            
            ctx.beginPath();
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Pulsing bullet body
        this.spiralOffset += 0.2;
        const pulseSize = Math.sin(this.spiralOffset) * 2 + this.visualWidth;
        
        ctx.globalAlpha = 1;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 15;
        
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - pulseSize/2, this.y - pulseSize/2, pulseSize, pulseSize);
        
        // Bright pulsing core
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffffff';
        const coreSize = 4 + Math.sin(this.spiralOffset * 2) * 1;
        ctx.fillRect(this.x - coreSize/2, this.y - coreSize/2, coreSize, coreSize);
        
        ctx.restore();
    }

    update() {
        // Optimized enemy finding - only check every few frames
        if (this.lifetime % 5 === 0) {
            let nearestEnemy = null;
            let nearestDistanceSq = Infinity;
            const homingRangeSq = 200 * 200; // Use squared distance
            
            for (let i = 0; i < enemies.length; i++) {
                const enemy = enemies[i];
                const dx = enemy.x - this.x;
                const dy = enemy.y - this.y;
                const distSq = dx * dx + dy * dy;
                
                if (distSq < nearestDistanceSq && distSq < homingRangeSq) {
                    nearestDistanceSq = distSq;
                    nearestEnemy = enemy;
                }
            }
            
            this.target = nearestEnemy;
        }

        // Home towards target
        if (this.target) {
            const targetAngle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
            let angleDiff = targetAngle - this.angle;
            
            // Normalize angle difference
            if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            else if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            this.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), this.turnSpeed);
        }

        const result = super.update();
        
        // If this homing bullet has explosive property and was destroyed, explode
        if (!result && this.explosive) {
            this.explode();
        }
        
        return result;
    }

    explode() {
        // Visual explosion effect (same as ExplosiveBullet)
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#ff6600';
        ctx.shadowColor = '#ff6600';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 50, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        
        // Damage all enemies in explosion radius
        enemies.forEach(enemy => {
            const dist = Math.hypot(enemy.x - this.x, enemy.y - this.y);
            if (dist < 50) {
                enemy.takeDamage(this.damage * 0.7);
            }
        });
    }
}

class ExplosiveBullet extends Bullet {
    constructor(x, y, angle, damage, color) {
        super(x, y, angle, damage, color);
        this.explosionRadius = 50; // Increased explosion radius
        this.visualWidth = 9; // Larger visual for explosive bullets
        this.visualHeight = 9;
        this.sparkles = [];
        this.flameOffset = 0;
    }

    update() {
        // Add sparkle effects to trail
        if (Math.random() < 0.3) {
            this.sparkles.push({
                x: this.x + (Math.random() - 0.5) * 10,
                y: this.y + (Math.random() - 0.5) * 10,
                life: 20,
                maxLife: 20
            });
        }
        
        // Add explosive trail particles
        if (this.lifetime % 2 === 0 && Math.random() < 0.4) {
            createTrailParticles(this.x, this.y, this.color, 'explosive');
        }
        
        // Update sparkles
        this.sparkles = this.sparkles.filter(sparkle => {
            sparkle.life--;
            return sparkle.life > 0;
        });
        
        return super.update();
    }

    draw() {
        ctx.save();
        
        // Fiery trail effect
        if (this.trail.length > 1) {
            for (let i = 0; i < this.trail.length - 1; i++) {
                const alpha = (i / this.trail.length) * 0.8;
                const width = (i / this.trail.length) * 6 + 2;
                
                // Fire gradient colors
                const fireColors = ['#ff0000', '#ff4400', '#ff8800', '#ffaa00'];
                const colorIndex = Math.floor((i / this.trail.length) * (fireColors.length - 1));
                
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = fireColors[colorIndex];
                ctx.lineWidth = width;
                
                ctx.beginPath();
                ctx.moveTo(this.trail[i].x, this.trail[i].y);
                ctx.lineTo(this.trail[i + 1].x, this.trail[i + 1].y);
                ctx.stroke();
            }
            
            // Hot center trail
            ctx.globalAlpha = 0.7;
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#ff4400';
            ctx.shadowBlur = 15;
            
            ctx.beginPath();
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Draw sparkles
        this.sparkles.forEach(sparkle => {
            const alpha = sparkle.life / sparkle.maxLife;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffff00';
            ctx.shadowColor = '#ff4400';
            ctx.shadowBlur = 5;
            ctx.fillRect(sparkle.x - 1, sparkle.y - 1, 2, 2);
        });

        // Flaming bullet body
        this.flameOffset += 0.3;
        const flameSize = Math.sin(this.flameOffset) * 2 + this.visualWidth;
        
        ctx.globalAlpha = 1;
        ctx.shadowColor = '#ff4400';
        ctx.shadowBlur = 20;
        
        // Outer flame
        ctx.fillStyle = '#ff4400';
        ctx.fillRect(this.x - flameSize/2, this.y - flameSize/2, flameSize, flameSize);
        
        // Inner fire
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ff8800';
        ctx.fillRect(this.x - (flameSize-2)/2, this.y - (flameSize-2)/2, flameSize-2, flameSize-2);
        
        // Hot core
        ctx.fillStyle = '#ffff00';
        ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
        
        ctx.restore();
    }

    explode() {
        // Visual explosion effect
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#ff6600';
        ctx.shadowColor = '#ff6600';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.explosionRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        
        // Damage all enemies in explosion radius
        enemies.forEach(enemy => {
            const dist = Math.hypot(enemy.x - this.x, enemy.y - this.y);
            if (dist < this.explosionRadius) {
                enemy.takeDamage(this.damage * 0.7); // Increased explosion damage
            }
        });
    }

    update() {
        const result = super.update();
        if (!result) { // Bullet was destroyed
            this.explode();
        }
        return result;
    }
}

class Enemy {
    constructor(x, y, type = 'basic') {
        this.x = x;
        this.y = y;
        this.type = type;
        this.width = 32; // Hitbox mais preciso
        this.height = 32;
        this.vx = 0;
        this.vy = 0;
        this.speed = CONFIG.ENEMY_SPEED;
        this.health = 120; // Aumentado de 40 para 120 (3x mais vida)
        this.maxHealth = 120;
        this.damage = 15; // Aumentado de 10 para 15
        this.points = 25;
        this.color = '#ffffff';
        this.lastShot = 0;
        this.shootRate = 1500; // milliseconds between shots
        this.targetX = player ? player.x : CONFIG.CANVAS_WIDTH / 2;
        this.targetY = player ? player.y : CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT - 50;
        this.aggroRange = 400; // Increased range for shooting
        this.optimalDistance = CONFIG.CANVAS_HEIGHT * 0.33; // 33% da altura do mapa
        this.personalSpace = 48; // Distância mínima entre inimigos
        this.separationForce = 0.8; // Força de separação entre inimigos
        this.spawnTime = 0; // Will be set to gameTime when spawned
        this.activationDelay = 500; // Tempo em ms antes de começar a perseguir
        this.killed = false; // flag de morte para evitar contagem dupla
        this.bulletSpeed = 4; // Velocidade dos projéteis inimigos
    }

    update() {
        // Don't update if not activated yet
        if (Date.now() - this.spawnTime < this.activationDelay) {
            return;
        }
        
        // Update target position to player's location
        this.targetX = player.x + player.width/2;
        this.targetY = player.y + player.height/2;
        
        // Calculate distance to player
        const distanceToPlayer = Math.hypot(this.targetX - this.x, this.targetY - this.y);
        
        // Enemy behavior: descend to middle of map height, then hover and shoot
        const mapMiddleY = CONFIG.CANVAS_HEIGHT / 2; // Metade da altura do mapa
        const currentY = this.y;
        
        // Movement logic
        if (currentY < mapMiddleY - 20) {
            // Still above middle - descend towards middle (much faster now)
            this.vy = this.speed * 1.5; // Muito mais rápido na descida
            this.vx = 0; // Don't move horizontally while descending
        } else {
            // At or below middle height - hover and track player horizontally
            this.vy = Math.sin(Date.now() * 0.003 + this.x * 0.01) * 0.5; // Gentle floating motion
            
            // Move horizontally towards player but slowly
            const horizontalDistance = this.targetX - this.x;
            if (Math.abs(horizontalDistance) > 50) {
                this.vx = Math.sign(horizontalDistance) * this.speed * 0.4; // Slightly faster horizontal tracking
            } else {
                this.vx *= 0.9; // Slow down when close horizontally
            }
        }
        
        // Collision avoidance with other enemies
        let avoidanceVx = 0;
        let avoidanceVy = 0;
        const personalSpace = 60; // Minimum distance between enemies
        const separationForce = 0.8; // How strong the separation force is
        
        enemies.forEach(otherEnemy => {
            if (otherEnemy !== this) {
                const distance = Math.hypot(otherEnemy.x - this.x, otherEnemy.y - this.y);
                if (distance < personalSpace && distance > 0) {
                    // Push away from other enemy
                    const pushX = (this.x - otherEnemy.x) / distance;
                    const pushY = (this.y - otherEnemy.y) / distance;
                    const pushForce = (personalSpace - distance) / personalSpace;
                    
                    avoidanceVx += pushX * pushForce * this.speed * separationForce;
                    avoidanceVy += pushY * pushForce * this.speed * separationForce;
                }
            }
        });
        
        // Apply movement with collision avoidance
        this.vx += avoidanceVx;
        this.vy += avoidanceVy;
        
        // Limit speed to prevent crazy movements
        const maxSpeed = this.speed * 2;
        const currentSpeed = Math.hypot(this.vx, this.vy);
        if (currentSpeed > maxSpeed) {
            this.vx = (this.vx / currentSpeed) * maxSpeed;
            this.vy = (this.vy / currentSpeed) * maxSpeed;
        }
        
        // Apply movement
        this.x += this.vx;
        this.y += this.vy;
        
        // Keep within screen bounds
        this.x = Math.max(this.width/2, Math.min(CONFIG.CANVAS_WIDTH - this.width/2, this.x));
        this.y = Math.max(0, Math.min(CONFIG.CANVAS_HEIGHT - this.height, this.y));
        
        // Shooting logic - only shoot when at middle height or below
        if (currentY >= mapMiddleY - 50 && distanceToPlayer <= this.aggroRange) {
            const now = Date.now();
            if (now - this.lastShot >= this.shootRate) {
                this.shoot();
                this.lastShot = now;
            }
        }
    }

    shoot() {
        // Calculate angle to player's location
        const angle = Math.atan2(this.targetY - this.y, this.targetX - this.x);
        
        // Initialize enemy bullets array if it doesn't exist
        if (!enemies.bullets) {
            enemies.bullets = [];
        }
        
        enemies.bullets.push(new EnemyBullet(this.x, this.y, angle, this.damage));
        
        // Play enemy shoot sound
        playSound(300, 0.1, 'triangle');
    }

    checkCollision(target) {
        // Center-based collision for enemies too
        const thisCenterX = this.x;
        const thisCenterY = this.y;
        const targetCenterX = target.x;
        const targetCenterY = target.y;
        
        return thisCenterX - this.width/2 < targetCenterX + target.width/2 &&
               thisCenterX + this.width/2 > targetCenterX - target.width/2 &&
               thisCenterY - this.height/2 < targetCenterY + target.height/2 &&
               thisCenterY + this.height/2 > targetCenterY - target.height/2;
    }

    takeDamage(amount) {
        if (this.killed) return; // já morto
        
        // Show damage indicator
        damageIndicators.push(new DamageIndicator(
            this.x + (Math.random() - 0.5) * 20, 
            this.y - 10, 
            amount, 
            '#ffffff'
        ));
        
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            this.killed = true;
            this.dropLoot();
            // Incrementa contadores globais de kill/score
            gameState.enemiesKilled++;
            gameState.score += this.points;
            // Som de morte
            playSound(400, 0.15, 'triangle');
            if (gameState.playerStats.lifesteal > 0) {
                player.health = Math.min(player.maxHealth, player.health + gameState.playerStats.lifesteal);
            }
        }
    }

    dropLoot() {
        // Check if this enemy was marked for a specific drop
        if (this.guaranteedDrop) {
            switch (this.guaranteedDrop) {
                case 'health':
                    drops.push(new HealthDrop(this.x, this.y));
                    break;
                case 'chest':
                    drops.push(new ChestDrop(this.x, this.y));
                    break;
                case 'bomb':
                    drops.push(new BombDrop(this.x, this.y));
                    break;
                case 'card':
                    drops.push(new CardDrop(this.x, this.y));
                    break;
            }
            return; // Guaranteed drop, no random chance
        }
        
        // Original random drop system for unmarked enemies
        // 1 in 10 chance for health orb
        if (Math.random() < 0.1) {
            drops.push(new HealthDrop(this.x, this.y));
        }
        // 1 in 20 chance for chest
        else if (Math.random() < 0.05) {
            drops.push(new ChestDrop(this.x, this.y));
        }
        // 1 in 50 chance for bomb
        else if (Math.random() < 0.02) {
            drops.push(new BombDrop(this.x, this.y));
        }
        // 1 in 30 chance for specific card
        else if (Math.random() < 0.033) {
            drops.push(new CardDrop(this.x, this.y));
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        
        const isActivated = Date.now() - this.spawnTime > this.activationDelay;
        const distanceToPlayer = Math.hypot(this.targetX - this.x, this.targetY - this.y);
        const directionToPlayer = Math.atan2(this.targetY - this.y, this.targetX - this.x);
        
        // Animation timing
        const time = Date.now() * 0.01;
        const breathe = Math.sin(time) * 2;
        const pulse = Math.sin(time * 2) * 0.5 + 0.5;
        
        // Determine enemy type based on color
        const isElite = this.color === '#ffaa44';
        const isBoss = this.color === '#ff4444';
        
        // Main body (demon-like creature) - different colors for special types
        let bodyColor = isActivated ? '#ffffff' : '#000000';
        if (isElite && isActivated) bodyColor = '#ffaa44'; // Orange for elite
        if (isBoss && isActivated) bodyColor = '#ff4444'; // Red for boss
        
        ctx.fillStyle = bodyColor;
        
        // Main body shape - larger for special types
        const sizeMultiplier = isBoss ? 1.3 : (isElite ? 1.1 : 1);
        ctx.beginPath();
        ctx.ellipse(0, 0, (this.width/2 + breathe) * sizeMultiplier, (this.height/2 + breathe) * sizeMultiplier, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Dark core/chest
        ctx.fillStyle = isActivated ? '#000000' : '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 2, (this.width/3) * sizeMultiplier, (this.height/3) * sizeMultiplier, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Spikes/horns on top - more spikes for special types
        const spikeCount = isBoss ? 5 : (isElite ? 4 : 3);
        ctx.fillStyle = isActivated ? '#000000' : '#ffffff';
        for (let i = 0; i < spikeCount; i++) {
            const angle = (i - (spikeCount - 1) / 2) * 0.6;
            const spikeX = Math.sin(angle) * 8 * sizeMultiplier;
            const spikeY = -this.height/2 - 4 * sizeMultiplier;
            const spikeHeight = isBoss ? 12 : (isElite ? 10 : 8);
            ctx.beginPath();
            ctx.moveTo(spikeX, spikeY);
            ctx.lineTo(spikeX - 3 * sizeMultiplier, spikeY - spikeHeight);
            ctx.lineTo(spikeX + 3 * sizeMultiplier, spikeY - spikeHeight);
            ctx.closePath();
            ctx.fill();
        }
        
        // Arms/tentacles - thicker for special types
        if (isActivated) {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3 * sizeMultiplier;
            ctx.lineCap = 'round';
            
            // Left arm
            ctx.beginPath();
            ctx.moveTo(-this.width/3 * sizeMultiplier, 0);
            ctx.quadraticCurveTo(-this.width/2 - 8 + breathe, -8, (-this.width/2 - 12 + breathe) * sizeMultiplier, 4);
            ctx.stroke();
            
            // Right arm
            ctx.beginPath();
            ctx.moveTo(this.width/3 * sizeMultiplier, 0);
            ctx.quadraticCurveTo(this.width/2 + 8 + breathe, -8, (this.width/2 + 12 + breathe) * sizeMultiplier, 4);
            ctx.stroke();
            
            // Claws - bigger for special types
            ctx.fillStyle = '#000000';
            const clawSize = 4 * sizeMultiplier;
            ctx.fillRect((-this.width/2 - 14 + breathe) * sizeMultiplier, 2, clawSize, 2 * sizeMultiplier);
            ctx.fillRect((this.width/2 + 10 + breathe) * sizeMultiplier, 2, clawSize, 2 * sizeMultiplier);
        } else {
            // Inactive arms (white/subtle)
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2 * sizeMultiplier;
            ctx.lineCap = 'round';
            
            // Left arm
            ctx.beginPath();
            ctx.moveTo(-this.width/4 * sizeMultiplier, 0);
            ctx.quadraticCurveTo(-this.width/3 + breathe, -4, (-this.width/3 - 6 + breathe) * sizeMultiplier, 2);
            ctx.stroke();
            
            // Right arm
            ctx.beginPath();
            ctx.moveTo(this.width/4 * sizeMultiplier, 0);
            ctx.quadraticCurveTo(this.width/3 + breathe, -4, (this.width/3 + 6 + breathe) * sizeMultiplier, 2);
            ctx.stroke();
        }
        
        // Eyes - glowing and tracking, bigger for special types
        const eyeGlow = isActivated ? pulse : 0;
        const glowColor = isBoss ? '#ff4444' : (isElite ? '#ffaa44' : '#ffffff');
        ctx.shadowColor = isActivated ? glowColor : '#000000';
        ctx.shadowBlur = eyeGlow * 8 * sizeMultiplier;
        
        ctx.fillStyle = isActivated ? '#000000' : '#ffffff';
        const eyeOffsetX = isActivated ? Math.cos(directionToPlayer) * 2 : 0;
        const eyeOffsetY = isActivated ? Math.sin(directionToPlayer) * 2 : 0;
        const eyeSize = 3 * sizeMultiplier;
        
        // Left eye
        ctx.beginPath();
        ctx.ellipse(-5 * sizeMultiplier + eyeOffsetX, -4 * sizeMultiplier + eyeOffsetY, eyeSize, eyeSize * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Right eye  
        ctx.beginPath();
        ctx.ellipse(5 * sizeMultiplier + eyeOffsetX, -4 * sizeMultiplier + eyeOffsetY, eyeSize, eyeSize * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Eye pupils
        ctx.shadowBlur = 0;
        ctx.fillStyle = isActivated ? glowColor : '#000000';
        const pupilSize = 2 * sizeMultiplier;
        ctx.fillRect(-6 * sizeMultiplier + eyeOffsetX, -5 * sizeMultiplier + eyeOffsetY, pupilSize, pupilSize);
        ctx.fillRect(4 * sizeMultiplier + eyeOffsetX, -5 * sizeMultiplier + eyeOffsetY, pupilSize, pupilSize);
        
        // Mouth/fangs - bigger for special types
        if (isActivated) {
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.ellipse(0, 6 * sizeMultiplier, 6 * sizeMultiplier, 3 * sizeMultiplier, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // Fangs - more and bigger for special types
            ctx.fillStyle = '#ffffff';
            const fangCount = isBoss ? 4 : (isElite ? 3 : 2);
            for (let i = 0; i < fangCount; i++) {
                const fangX = (i - (fangCount - 1) / 2) * 3 * sizeMultiplier;
                ctx.beginPath();
                ctx.moveTo(fangX, 4 * sizeMultiplier);
                ctx.lineTo(fangX - 2 * sizeMultiplier, 8 * sizeMultiplier);
                ctx.lineTo(fangX + 2 * sizeMultiplier, 8 * sizeMultiplier);
                ctx.closePath();
                ctx.fill();
            }
        } else {
            // Inactive mouth (simple white line)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-3 * sizeMultiplier, 6 * sizeMultiplier, 6 * sizeMultiplier, 1);
        }
        
        // Special aura for elite and boss enemies
        if ((isElite || isBoss) && isActivated) {
            ctx.save();
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 15 * pulse;
            ctx.strokeStyle = glowColor;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6 * pulse;
            ctx.beginPath();
            ctx.arc(0, 0, this.width/2 + 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        
        // Direction indicator (energy beam towards player)
        if (isActivated && distanceToPlayer < this.aggroRange) {
            ctx.save();
            ctx.rotate(directionToPlayer);
            const beamColor = isBoss ? '#ff4444' : (isElite ? '#ffaa44' : '#ffffff');
            ctx.fillStyle = `rgba(${beamColor === '#ff4444' ? '255, 68, 68' : beamColor === '#ffaa44' ? '255, 170, 68' : '255, 255, 255'}, ${pulse * 0.5})`;
            ctx.fillRect(this.width/2, -1, 8 * sizeMultiplier, 2);
            ctx.restore();
        }
        
        // Aura effect when close to player
        if (distanceToPlayer < 100) {
            const auraIntensity = 1 - (distanceToPlayer / 100);
            const auraColor = isBoss ? '#ff4444' : (isElite ? '#ffaa44' : '#ffffff');
            ctx.shadowColor = auraColor;
            ctx.shadowBlur = 20 * auraIntensity;
            ctx.strokeStyle = `rgba(${auraColor === '#ff4444' ? '255, 68, 68' : auraColor === '#ffaa44' ? '255, 170, 68' : '255, 255, 255'}, ${auraIntensity * 0.5})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, this.width/2 + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        
        ctx.restore();
        
        // Health bar (pure black and white) - bigger for special types
        if (this.health < this.maxHealth) {
            const barWidth = (this.width + 4) * sizeMultiplier;
            const barHeight = 4 * sizeMultiplier;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(this.x - barWidth/2 - 1, this.y - this.height/2 - 13 * sizeMultiplier, barWidth + 2, barHeight + 2);
            ctx.fillStyle = '#000000';
            ctx.fillRect(this.x - barWidth/2, this.y - this.height/2 - 12 * sizeMultiplier, barWidth, barHeight);
            
            // Health bar color based on enemy type
            const healthColor = isBoss ? '#ff4444' : (isElite ? '#ffaa44' : '#ffffff');
            ctx.fillStyle = healthColor;
            ctx.fillRect(this.x - barWidth/2, this.y - this.height/2 - 12 * sizeMultiplier, 
                        barWidth * (this.health / this.maxHealth), barHeight);
        }
        
        // Aggro line (more stylized) - different colors for special types
        if (isActivated && distanceToPlayer < this.aggroRange && distanceToPlayer > this.optimalDistance - 50) {
            const lineColor = isBoss ? '#ff4444' : (isElite ? '#ffaa44' : '#ffffff');
            ctx.strokeStyle = `rgba(${lineColor === '#ff4444' ? '255, 68, 68' : lineColor === '#ffaa44' ? '255, 170, 68' : '255, 255, 255'}, ${pulse * 0.4})`;
            ctx.lineWidth = isBoss ? 2 : 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.targetX, this.targetY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

class EnemyBullet {
    constructor(x, y, angle, damage) {
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.speed = 3;
        this.damage = damage;
        this.width = 10; // Larger hitbox for enemy bullets
        this.height = 10;
        this.visualWidth = 8; // Visual size maior
        this.visualHeight = 8;
        this.lifetime = 150;
        this.trail = [];
        this.darkPulse = 0;
    }

    update() {
        // Add to trail
        this.trail.push({x: this.x, y: this.y});
        if (this.trail.length > 8) this.trail.shift();
        
        // Apply magnetism effect if player has it
        if (gameState.playerStats.magnetism) {
            const magnetRange = 20 + (gameState.playerStats.magnetismLevel || 0) * 10;
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < magnetRange && distance > 0) {
                const magnetForce = 0.05 * (gameState.playerStats.magnetismLevel || 1);
                const magnetAngle = Math.atan2(dy, dx);
                
                // Gradually bend the bullet towards player
                let angleDiff = magnetAngle - this.angle;
                if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                else if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                
                this.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), magnetForce);
            }
        }
        
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        this.lifetime--;
        this.darkPulse += 0.2;

        // Remove if out of bounds
        if (this.x < 0 || this.x > CONFIG.CANVAS_WIDTH || 
            this.y < 0 || this.y > CONFIG.CANVAS_HEIGHT || 
            this.lifetime <= 0) {
            return false;
        }

        // Check collision with player
        if (this.checkCollision(player)) {
            player.takeDamage(this.damage);
            return false;
        }

        return true;
    }

    checkCollision(target) {
        // Center-based collision for enemy bullets
        const thisCenterX = this.x;
        const thisCenterY = this.y;
        const targetCenterX = target.x;
        const targetCenterY = target.y;
        
        return thisCenterX - this.width/2 < targetCenterX + target.width/2 &&
               thisCenterX + this.width/2 > targetCenterX - target.width/2 &&
               thisCenterY - this.height/2 < targetCenterY + target.height/2 &&
               thisCenterY + this.height/2 > targetCenterY - target.height/2;
    }

    draw() {
        ctx.save();
        
        // Dark menacing trail for enemy bullets
        if (this.trail.length > 1) {
            for (let i = 0; i < this.trail.length - 1; i++) {
                const alpha = (i / this.trail.length) * 0.6;
                const width = (i / this.trail.length) * 4 + 1;
                
                // Dark red to black gradient
                const darkness = 1 - (i / this.trail.length);
                const redValue = Math.floor(255 * darkness * 0.8);
                const trailColor = `rgba(${redValue}, ${Math.floor(redValue * 0.3)}, 0, ${alpha})`;
                
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = trailColor;
                ctx.lineWidth = width;
                
                ctx.beginPath();
                ctx.moveTo(this.trail[i].x, this.trail[i].y);
                ctx.lineTo(this.trail[i + 1].x, this.trail[i + 1].y);
                ctx.stroke();
            }
            
            // Dark center trail with pulsing effect
            ctx.globalAlpha = 0.8;
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#ff0000';
            ctx.shadowBlur = 6 + Math.sin(this.darkPulse) * 3;
            
            ctx.beginPath();
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        
        // Menacing bullet body with dark aura
        const pulseSize = Math.sin(this.darkPulse) * 1 + this.visualWidth;
        
        ctx.globalAlpha = 1;
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 15;
        
        // Dark red outer shell
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(this.x - pulseSize/2, this.y - pulseSize/2, pulseSize, pulseSize);
        
        // Darker red inner
        ctx.shadowColor = '#aa0000';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#cc2222';
        ctx.fillRect(this.x - (pulseSize-2)/2, this.y - (pulseSize-2)/2, pulseSize-2, pulseSize-2);
        
        // Dark core with red glow
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 4;
        ctx.fillStyle = '#000000';
        ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
        
        ctx.restore();
    }
}

// Removed Particle class for minimal visual style

// Environment Effects System
class Lightning {
    constructor(x, damage) {
        this.x = x;
        this.y = 0;
        this.damage = damage;
        this.width = 8;
        this.height = CONFIG.CANVAS_HEIGHT;
        this.lifetime = 30; // frames
        this.maxLifetime = 30;
    }
    
    update() {
        this.lifetime--;
        
        // Check collision with enemies
        enemies.forEach(enemy => {
            if (enemy.x + enemy.width > this.x - this.width/2 && 
                enemy.x < this.x + this.width/2) {
                enemy.takeDamage(this.damage);
            }
        });
        
        return this.lifetime > 0;
    }
    
    draw() {
        const alpha = this.lifetime / this.maxLifetime;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Lightning bolt effect
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = this.width;
        ctx.beginPath();
        
        // Zigzag pattern
        let currentY = 0;
        let currentX = this.x;
        ctx.moveTo(currentX, currentY);
        
        while (currentY < this.height) {
            currentY += 40 + Math.random() * 20;
            currentX += (Math.random() - 0.5) * 20;
            ctx.lineTo(currentX, currentY);
        }
        
        ctx.stroke();
        
        // Inner bright core
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.restore();
    }
}

class Meteor {
    constructor(x, y, damage) {
        this.x = x;
        this.y = y;
        this.targetX = x;
        this.targetY = CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT;
        this.damage = damage;
        this.speed = 8;
        this.size = 12;
        this.trail = [];
    }
    
    update() {
        // Move towards target
        const angle = Math.atan2(this.targetY - this.y, this.targetX - this.x);
        this.x += Math.cos(angle) * this.speed;
        this.y += Math.sin(angle) * this.speed;
        
        // Add trail
        this.trail.push({x: this.x, y: this.y});
        if (this.trail.length > 8) this.trail.shift();
        
        // Check if hit ground or enemy
        if (this.y >= this.targetY - 20) {
            this.explode();
            return false;
        }
        
        // Check collision with enemies
        enemies.forEach(enemy => {
            if (Math.abs(enemy.x - this.x) < 30 && Math.abs(enemy.y - this.y) < 30) {
                enemy.takeDamage(this.damage);
                this.explode();
                return false;
            }
        });
        
        return true;
    }
    
    explode() {
        // Clean explosion - no particles
        
        // Area damage
        enemies.forEach(enemy => {
            const dist = Math.sqrt((enemy.x - this.x) ** 2 + (enemy.y - this.y) ** 2);
            if (dist < 60) {
                enemy.takeDamage(this.damage * 0.5);
            }
        });
    }
    
    draw() {
        // Draw trail
        ctx.strokeStyle = '#ff4400';
        ctx.lineWidth = 6;
        ctx.beginPath();
        this.trail.forEach((point, i) => {
            const alpha = i / this.trail.length;
            ctx.globalAlpha = alpha;
            if (i === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
        
        // Draw meteor
        ctx.fillStyle = '#ff6600';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        
        // Core
        ctx.fillStyle = '#ffff00';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Thorn {
    constructor(x, damage) {
        this.x = x;
        this.y = CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT;
        this.damage = damage;
        this.height = 0;
        this.maxHeight = 80;
        this.growing = true;
        this.lifetime = 180; // 3 seconds
        this.maxLifetime = 180;
    }
    
    update() {
        if (this.growing && this.height < this.maxHeight) {
            this.height += 4;
        } else {
            this.growing = false;
            this.lifetime--;
        }
        
        // Check collision with enemies
        if (this.height > 20) {
            enemies.forEach(enemy => {
                if (Math.abs(enemy.x - this.x) < 25 && 
                    enemy.y + enemy.height > this.y - this.height) {
                    enemy.takeDamage(this.damage);
                }
            });
        }
        
        return this.lifetime > 0;
    }
    
    draw() {
        const alpha = this.lifetime / this.maxLifetime;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Draw thorn spike
        ctx.fillStyle = '#00aa00';
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - 8, this.y - this.height * 0.3);
        ctx.lineTo(this.x - 4, this.y - this.height);
        ctx.lineTo(this.x + 4, this.y - this.height);
        ctx.lineTo(this.x + 8, this.y - this.height * 0.3);
        ctx.closePath();
        ctx.fill();
        
        // Highlight
        ctx.fillStyle = '#00ff00';
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x - 2, this.y - this.height * 0.8);
        ctx.lineTo(this.x, this.y - this.height);
        ctx.lineTo(this.x + 2, this.y - this.height * 0.8);
        ctx.closePath();
        ctx.fill();
        
        ctx.restore();
    }
}

class PoisonCloud {
    constructor(x, y, damage) {
        this.x = x;
        this.y = y;
        this.damage = damage;
        this.radius = 10;
        this.maxRadius = 50;
        this.lifetime = 300; // 5 seconds
        this.maxLifetime = 300;
        this.damageTimer = 0;
    }
    
    update() {
        if (this.radius < this.maxRadius) {
            this.radius += 1;
        }
        
        this.lifetime--;
        this.damageTimer++;
        
        // Damage enemies every 30 frames (0.5 seconds)
        if (this.damageTimer >= 30) {
            this.damageTimer = 0;
            enemies.forEach(enemy => {
                const dist = Math.sqrt((enemy.x - this.x) ** 2 + (enemy.y - this.y) ** 2);
                if (dist < this.radius) {
                    enemy.takeDamage(this.damage);
                }
            });
        }
        
        return this.lifetime > 0;
    }
    
    draw() {
        const alpha = (this.lifetime / this.maxLifetime) * 0.6;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Draw poison cloud
        ctx.fillStyle = '#44aa00';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner toxic glow
        ctx.globalAlpha = alpha * 0.3;
        ctx.fillStyle = '#88ff00';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 0.7, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

class FirePillar {
    constructor(x, damage) {
        this.x = x;
        this.y = CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT;
        this.damage = damage;
        this.height = 0;
        this.maxHeight = 100;
        this.growing = true;
        this.lifetime = 240; // 4 seconds
        this.maxLifetime = 240;
        this.damageTimer = 0;
        this.flameOffset = Math.random() * Math.PI * 2;
    }
    
    update() {
        if (this.growing && this.height < this.maxHeight) {
            this.height += 5;
        } else {
            this.growing = false;
            this.lifetime--;
        }
        
        this.damageTimer++;
        
        // Damage enemies every 20 frames
        if (this.damageTimer >= 20 && this.height > 30) {
            this.damageTimer = 0;
            enemies.forEach(enemy => {
                if (Math.abs(enemy.x - this.x) < 30 && 
                    enemy.y + enemy.height > this.y - this.height) {
                    enemy.takeDamage(this.damage);
                }
            });
        }
        
        return this.lifetime > 0;
    }
    
    draw() {
        const alpha = this.lifetime / this.maxLifetime;
        ctx.save();
        ctx.globalAlpha = alpha;
        
        // Animated flame effect
        const time = Date.now() * 0.01;
        const flameWidth = 20 + Math.sin(time + this.flameOffset) * 8;
        
        // Base fire
        ctx.fillStyle = '#ff4400';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, flameWidth, this.height, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner flame
        ctx.fillStyle = '#ff8800';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, flameWidth * 0.7, this.height * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // Core
        ctx.fillStyle = '#ffff00';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, flameWidth * 0.3, this.height * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

// Environment effects arrays
let environmentObjects = {
    lightning: [],
    meteors: [],
    thorns: [],
    poisonClouds: [],
    firePillars: []
};

function processEnvironmentEffects(gameTime) {
    const effects = gameState.environmentEffects;
    
    // Lightning strikes - 2 seconds base
    if (effects.lightning.active) {
        const interval = Math.max(1000, 2000 - effects.lightning.level * 250); // 2s base, faster with level
        if (gameTime - effects.lightning.lastTrigger > interval) {
            effects.lightning.lastTrigger = gameTime;
            
            const x = Math.random() * CONFIG.CANVAS_WIDTH;
            const damage = 30 + effects.lightning.level * 15;
            environmentObjects.lightning.push(new Lightning(x, damage));
            
            // Lightning sound effect
            playSound(800 + Math.random() * 400, 200, 'sawtooth');
        }
    }
    
    // Meteor shower - 3 seconds base
    if (effects.meteor.active) {
        const interval = Math.max(1500, 3000 - effects.meteor.level * 300);
        if (gameTime - effects.meteor.lastTrigger > interval) {
            effects.meteor.lastTrigger = gameTime;
            
            const x = Math.random() * CONFIG.CANVAS_WIDTH;
            const y = -50;
            const damage = 40 + effects.meteor.level * 20;
            environmentObjects.meteors.push(new Meteor(x, y, damage));
        }
    }
    
    // Thorn spikes - 4 seconds base
    if (effects.thorns.active) {
        const interval = Math.max(2000, 4000 - effects.thorns.level * 500);
        if (gameTime - effects.thorns.lastTrigger > interval) {
            effects.thorns.lastTrigger = gameTime;
            
            const x = Math.random() * CONFIG.CANVAS_WIDTH;
            const damage = 25 + effects.thorns.level * 12;
            environmentObjects.thorns.push(new Thorn(x, damage));
        }
    }
    
    // Poison clouds - 5 seconds base
    if (effects.poison.active) {
        const interval = Math.max(3000, 5000 - effects.poison.level * 600);
        if (gameTime - effects.poison.lastTrigger > interval) {
            effects.poison.lastTrigger = gameTime;
            
            const x = Math.random() * CONFIG.CANVAS_WIDTH;
            const y = Math.random() * (CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT - 100) + 50;
            const damage = 8 + effects.poison.level * 4;
            environmentObjects.poisonClouds.push(new PoisonCloud(x, y, damage));
        }
    }
    
    // Fire pillars - 4.5 seconds base
    if (effects.fire.active) {
        const interval = Math.max(2500, 4500 - effects.fire.level * 550);
        if (gameTime - effects.fire.lastTrigger > interval) {
            effects.fire.lastTrigger = gameTime;
            
            const x = Math.random() * CONFIG.CANVAS_WIDTH;
            const damage = 20 + effects.fire.level * 10;
            environmentObjects.firePillars.push(new FirePillar(x, damage));
        }
    }
    
    // Update all environment objects
    environmentObjects.lightning = environmentObjects.lightning.filter(obj => obj.update());
    environmentObjects.meteors = environmentObjects.meteors.filter(obj => obj.update());
    environmentObjects.thorns = environmentObjects.thorns.filter(obj => obj.update());
    environmentObjects.poisonClouds = environmentObjects.poisonClouds.filter(obj => obj.update());
    environmentObjects.firePillars = environmentObjects.firePillars.filter(obj => obj.update());
}

// Will-o-Wisp companion class
class WillOWisp {
    constructor(player) {
        this.player = player;
        this.x = player.x;
        this.y = player.y;
        this.angle = 0;
        this.distance = 40;
        this.lastShot = 0;
        this.shootRate = 800; // Shoots every 800ms
        this.level = 1;
    }

    update(gameTime) {
        // Orbit around player
        this.angle += 0.05;
        this.x = this.player.x + Math.cos(this.angle) * this.distance;
        this.y = this.player.y + Math.sin(this.angle) * this.distance;
        
        // Auto-shoot at nearest enemy
        if (gameTime - this.lastShot >= this.shootRate && enemies.length > 0) {
            this.shoot();
            this.lastShot = gameTime;
        }
    }

    shoot() {
        // Find nearest enemy
        let nearestEnemy = null;
        let nearestDistance = Infinity;
        
        enemies.forEach(enemy => {
            const dx = enemy.x - this.x;
            const dy = enemy.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestEnemy = enemy;
            }
        });
        
        if (nearestEnemy) {
            const dx = nearestEnemy.x - this.x;
            const dy = nearestEnemy.y - this.y;
            const angle = Math.atan2(dy, dx);
            
            // Create wisp bullet with 25% of player damage
            const damage = gameState.playerStats.damage * 0.25 * this.level;
            const bullet = new WispBullet(this.x, this.y, angle, damage, '#88ffff');
            bullet.isWispShot = true;
            bullets.push(bullet);
        }
    }

    draw() {
        // Draw wisp as glowing orb
        ctx.save();
        ctx.globalAlpha = 0.8;
        
        // Outer glow
        const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, 12);
        gradient.addColorStop(0, '#88ffff');
        gradient.addColorStop(0.5, '#4488ff');
        gradient.addColorStop(1, 'transparent');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.x, this.y, 12, 0, Math.PI * 2);
        ctx.fill();
        
        // Core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
}

// Ricochet bullet class
class RicochetBullet extends Bullet {
    constructor(x, y, angle, damage, color) {
        super(x, y, angle, damage, color);
        this.ricochets = 0;
        this.maxRicochets = 3;
        this.damageReduction = 0.7; // Each ricochet reduces damage to 70%
    }

    update() {
        const prevX = this.x;
        const prevY = this.y;
        
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        
        // Check wall collisions for ricochet
        let bounced = false;
        
        // Left/right walls
        if (this.x <= 0 || this.x >= CONFIG.CANVAS_WIDTH) {
            this.angle = Math.PI - this.angle;
            this.x = Math.max(0, Math.min(CONFIG.CANVAS_WIDTH, this.x));
            bounced = true;
        }
        
        // Top wall
        if (this.y <= 0) {
            this.angle = -this.angle;
            this.y = 0;
            bounced = true;
        }
        
        // Ground collision
        const terrainHeight = getTerrainHeightAt(this.x);
        if (this.y >= terrainHeight) {
            this.angle = -this.angle;
            this.y = terrainHeight - 1;
            bounced = true;
        }
        
        if (bounced) {
            this.ricochets++;
            this.damage *= this.damageReduction;
            
            // Destroy if too many ricochets or damage too low
            if (this.ricochets >= this.maxRicochets || this.damage < 1) {
                return false;
            }
        }
        
        // Check enemy collisions
        for (let i = enemies.length - 1; i >= 0; i--) {
            if (this.checkCollision(enemies[i])) {
                return false; // Bullet destroyed on hit
            }
        }
        
        // Remove if off screen (shouldn't happen with ricochets)
        return this.x > -50 && this.x < CONFIG.CANVAS_WIDTH + 50 && 
               this.y > -50 && this.y < CONFIG.CANVAS_HEIGHT + 50;
    }

    draw() {
        ctx.save();
        
        // Enhanced ricochet trail with electric effect
        if (this.trail.length > 1) {
            for (let i = 0; i < this.trail.length - 1; i++) {
                const alpha = (i / this.trail.length) * 0.7;
                const width = (i / this.trail.length) * 3 + 1;
                
                // Electric blue color that gets brighter with ricochets
                const intensity = Math.min(1, this.ricochets * 0.3);
                const electricColor = `rgba(${100 + intensity * 155}, ${150 + intensity * 105}, 255, ${alpha})`;
                
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = electricColor;
                ctx.lineWidth = width;
                
                // Add electric jitter to trail
                const jitterX = (Math.random() - 0.5) * this.ricochets * 2;
                const jitterY = (Math.random() - 0.5) * this.ricochets * 2;
                
                ctx.beginPath();
                ctx.moveTo(this.trail[i].x + jitterX, this.trail[i].y + jitterY);
                ctx.lineTo(this.trail[i + 1].x, this.trail[i + 1].y);
                ctx.stroke();
            }
            
            // Electric center trail
            ctx.globalAlpha = 0.8;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.shadowColor = '#00ffff';
            ctx.shadowBlur = 8 + this.ricochets * 2;
            
            ctx.beginPath();
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Electric bullet body with ricochet aura
        ctx.globalAlpha = 1;
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 12 + this.ricochets * 3;
        
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.visualWidth/2, this.y - this.visualHeight/2, 
                    this.visualWidth, this.visualHeight);
        
        // Electric core
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x - 2, this.y - 2, 4, 4);
        
        // Ricochet indicator rings
        if (this.ricochets > 0) {
            for (let r = 0; r < this.ricochets; r++) {
                ctx.globalAlpha = 0.4 - r * 0.1;
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                
                ctx.beginPath();
                ctx.arc(this.x, this.y, 8 + r * 4, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
        
        ctx.restore();
    }
}

// Explosive death bullet class
class ExplosiveDeathBullet extends Bullet {
    constructor(x, y, angle, damage, color) {
        super(x, y, angle, damage * 0.4, color); // Mini bullets do 40% damage
        this.isMiniBullet = true;
    }
}

// Damage indicator class
class DamageIndicator {
    constructor(x, y, damage, color = '#ffffff') {
        this.x = x;
        this.y = y;
        this.damage = Math.floor(damage);
        this.color = color;
        this.life = 60; // 1 second at 60fps
        this.maxLife = 60;
        this.vy = -2; // Float upward
        this.vx = (Math.random() - 0.5) * 2; // Slight horizontal drift
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;
        this.vy *= 0.98; // Slow down over time
        return this.life > 0;
    }

    draw() {
        const alpha = this.life / this.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.font = 'bold 12px "Press Start 2P", Arial, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Shadow for visibility
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        
        ctx.fillText(this.damage.toString(), this.x, this.y);
        ctx.restore();
    }
}

// Drop base class
class Drop {
    constructor(x, y, type, color) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.color = color;
        this.width = 16;
        this.height = 16;
        this.vy = -1; // Float upward initially
        this.vx = (Math.random() - 0.5) * 2;
        this.bounces = 0;
        this.maxBounces = 3;
        this.collected = false;
        this.glowOffset = Math.random() * Math.PI * 2;
        this.magnetRange = 60;
    }

    update() {
        // Apply gravity after initial upward movement
        if (this.bounces > 0) {
            this.vy += 0.3;
        } else {
            this.vy += 0.1;
        }
        
        // Check for magnet effect from player
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < this.magnetRange) {
            const magnetForce = 0.3;
            this.vx += (dx / distance) * magnetForce;
            this.vy += (dy / distance) * magnetForce;
        }
        
        this.x += this.vx;
        this.y += this.vy;
        
        // Bounce on ground
        const terrainHeight = getTerrainHeightAt(this.x);
        if (this.y + this.height/2 >= terrainHeight && this.vy > 0) {
            this.y = terrainHeight - this.height/2;
            this.vy *= -0.6; // Bounce with energy loss
            this.vx *= 0.8; // Friction
            this.bounces++;
            
            if (this.bounces >= this.maxBounces) {
                this.vy = 0;
                this.vx = 0;
            }
        }
        
        // Check collection by player
        if (Math.abs(player.x - this.x) < 20 && Math.abs(player.y - this.y) < 20) {
            this.collect();
            return false;
        }
        
        // Remove if off screen
        return this.x > -50 && this.x < CONFIG.CANVAS_WIDTH + 50 && this.y < CONFIG.CANVAS_HEIGHT + 50;
    }

    draw() {
        this.glowOffset += 0.1;
        const glowIntensity = Math.sin(this.glowOffset) * 0.3 + 0.7;
        
        ctx.save();
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10 * glowIntensity;
        
        // Outer glow
        ctx.fillStyle = this.color;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(this.x - this.width/2, this.y - this.height/2, this.width, this.height);
        
        // Inner bright core
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 1;
        ctx.fillRect(this.x - this.width/2 + 2, this.y - this.height/2 + 2, this.width - 4, this.height - 4);
        
        // Icon/symbol in center
        ctx.fillStyle = this.color;
        ctx.font = 'bold 10px "Press Start 2P", Arial, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.getSymbol(), this.x, this.y);
        
        ctx.restore();
    }

    getSymbol() {
        return '?';
    }

    collect() {
        this.collected = true;
        // Override in subclasses
    }
}

// Health orb drop
class HealthDrop extends Drop {
    constructor(x, y) {
        super(x, y, 'health', '#00ff00');
    }

    getSymbol() {
        return '+';
    }

    collect() {
        super.collect();
        player.health = Math.min(player.health + 10, gameState.playerStats.maxHealth);
        updateUI();
        playSound(400, 0.2, 'sine');
        
        // Visual feedback
        damageIndicators.push(new DamageIndicator(this.x, this.y - 10, '+10', '#00ff00'));
        
        // Create healing particles
        createDropParticles(this.x, this.y, '#00ff00', 'glow');
    }
}

// Chest drop (card purchase)
class ChestDrop extends Drop {
    constructor(x, y) {
        super(x, y, 'chest', '#ffaa00');
    }

    getSymbol() {
        return '□';
    }

    collect() {
        super.collect();
        showCardSelection();
        playSound(600, 0.3, 'triangle');
        
        // Create golden particles
        createDropParticles(this.x, this.y, '#ffaa00', 'glow');
    }
}

// Bomb drop (clear all enemies)
class BombDrop extends Drop {
    constructor(x, y) {
        super(x, y, 'bomb', '#ff4444');
    }

    getSymbol() {
        return '*';
    }

    collect() {
        super.collect();
        // Clear all enemies with explosion effect
        enemies.forEach(enemy => {
            // Create explosion effect at enemy position
            for (let i = 0; i < 8; i++) {
                const angle = (Math.PI * 2 / 8) * i;
                const explosionX = enemy.x + Math.cos(angle) * 20;
                const explosionY = enemy.y + Math.sin(angle) * 20;
                damageIndicators.push(new DamageIndicator(explosionX, explosionY, 'BOOM', '#ff4444'));
            }
            enemy.killed = true;
            gameState.score += enemy.points;
        });
        
        // Clear enemies array
        enemies.length = 0;
        
        playSound(200, 0.5, 'sawtooth');
        
        // Visual feedback
        damageIndicators.push(new DamageIndicator(this.x, this.y - 10, 'CLEAR!', '#ff4444'));
        
        // Create explosive particles
        createDropParticles(this.x, this.y, '#ff4444', 'spark');
    }
}

// Specific card drop
class CardDrop extends Drop {
    constructor(x, y) {
        super(x, y, 'card', '#aa44ff');
        
        // Select a random card from all available cards
        const allCards = [...CARDS.common, ...CARDS.uncommon, ...CARDS.epic, ...CARDS.legendary];
        this.card = allCards[Math.floor(Math.random() * allCards.length)];
    }

    getSymbol() {
        return '◊';
    }

    collect() {
        super.collect();
        
        // Apply card effect directly
        const ownedCard = gameState.ownedCards.find(owned => owned.name === this.card.name);
        
        if (ownedCard && this.card.stackable) {
            // Upgrade existing card
            ownedCard.level++;
            this.card.effect(ownedCard.level);
        } else if (!ownedCard) {
            // Add new card
            const cardWithInfo = {
                name: this.card.name,
                rarity: this.getRarity(),
                level: 1
            };
            gameState.ownedCards.push(cardWithInfo);
            this.card.effect(1);
        }
        
        playSound(800, 0.4, 'triangle');
        
        // Visual feedback
        damageIndicators.push(new DamageIndicator(this.x, this.y - 10, this.card.name, '#aa44ff'));
        
        // Create magical particles
        createDropParticles(this.x, this.y, '#aa44ff', 'glow');
    }

    getRarity() {
        if (CARDS.legendary.includes(this.card)) return 'legendary';
        if (CARDS.epic.includes(this.card)) return 'epic';
        if (CARDS.uncommon.includes(this.card)) return 'uncommon';
        return 'common';
    }
}

// Will-o-Wisp bullet class
class WispBullet extends Bullet {
    constructor(x, y, angle, damage, color) {
        super(x, y, angle, damage, color);
        this.etherealOffset = 0;
        this.particles = [];
    }

    update() {
        // Add ethereal particles
        if (Math.random() < 0.4) {
            this.particles.push({
                x: this.x + (Math.random() - 0.5) * 8,
                y: this.y + (Math.random() - 0.5) * 8,
                life: 15,
                maxLife: 15,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2
            });
        }
        
        // Update particles
        this.particles = this.particles.filter(particle => {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life--;
            return particle.life > 0;
        });
        
        return super.update();
    }

    draw() {
        ctx.save();
        
        // Ethereal trail effect
        if (this.trail.length > 1) {
            for (let i = 0; i < this.trail.length - 1; i++) {
                const alpha = (i / this.trail.length) * 0.6;
                const width = (i / this.trail.length) * 3 + 1;
                
                // Cyan to white gradient
                const intensity = i / this.trail.length;
                const trailColor = `rgba(${100 + intensity * 155}, ${200 + intensity * 55}, 255, ${alpha})`;
                
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = trailColor;
                ctx.lineWidth = width;
                
                ctx.beginPath();
                ctx.moveTo(this.trail[i].x, this.trail[i].y);
                ctx.lineTo(this.trail[i + 1].x, this.trail[i + 1].y);
                ctx.stroke();
            }
            
            // Ghostly center trail
            ctx.globalAlpha = 0.7;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.shadowColor = '#88ffff';
            ctx.shadowBlur = 10;
            
            ctx.beginPath();
            ctx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Draw ethereal particles
        this.particles.forEach(particle => {
            const alpha = particle.life / particle.maxLife;
            ctx.globalAlpha = alpha * 0.8;
            ctx.fillStyle = '#88ffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 3;
            ctx.fillRect(particle.x - 1, particle.y - 1, 2, 2);
        });

        // Ethereal bullet body
        this.etherealOffset += 0.15;
        const ghostSize = Math.sin(this.etherealOffset) * 1 + this.visualWidth;
        
        ctx.globalAlpha = 0.9;
        ctx.shadowColor = '#88ffff';
        ctx.shadowBlur = 12;
        
        // Outer ethereal glow
        ctx.fillStyle = '#88ffff';
        ctx.fillRect(this.x - ghostSize/2, this.y - ghostSize/2, ghostSize, ghostSize);
        
        // Inner spirit light
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#aaffff';
        ctx.fillRect(this.x - (ghostSize-2)/2, this.y - (ghostSize-2)/2, ghostSize-2, ghostSize-2);
        
        // Bright spirit core
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x - 1, this.y - 1, 2, 2);
        
        ctx.restore();
    }
}

class Particle {
    constructor(x, y, vx, vy, color, size, lifetime, type = 'normal') {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.size = size;
        this.maxLifetime = lifetime;
        this.lifetime = lifetime;
        this.type = type;
        this.alpha = 1;
        this.gravity = type === 'spark' ? 0.1 : 0.05;
        this.bounce = type === 'spark' ? 0.6 : 0.3;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        
        // Apply gravity for spark particles
        if (this.type === 'spark') {
            this.vy += this.gravity;
            
            // Bounce off ground
            const terrainHeight = getTerrainHeightAt(this.x);
            if (this.y >= terrainHeight) {
                this.y = terrainHeight;
                this.vy *= -this.bounce;
                this.vx *= 0.8; // Friction
            }
        } else {
            this.vy += this.gravity * 0.5;
        }
        
        // Fade over time
        this.lifetime--;
        this.alpha = this.lifetime / this.maxLifetime;
        
        // Shrink over time for some types
        if (this.type === 'glow') {
            this.size = (this.lifetime / this.maxLifetime) * this.size;
        }
        
        return this.lifetime > 0;
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        
        if (this.type === 'glow') {
            // Glowing particle with bloom effect
            ctx.shadowColor = this.color;
            ctx.shadowBlur = this.size * 2;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'spark') {
            // Sharp spark particle
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x - this.size/2, this.y - this.size/2, this.size, this.size);
        } else {
            // Normal particle
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }
}

// Particle creation functions
function createTrailParticles(x, y, color, type = 'normal') {
    const count = type === 'explosive' ? 3 : type === 'homing' ? 2 : 1;
    
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 0.5 + 0.2;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const size = Math.random() * 2 + 1;
        const lifetime = Math.random() * 20 + 10;
        
        particles.push(new Particle(x, y, vx, vy, color, size, lifetime, 'glow'));
    }
}

function createDropParticles(x, y, color, type = 'normal') {
    const count = 8;
    
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
        const speed = Math.random() * 2 + 1;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 1; // Upward bias
        const size = Math.random() * 3 + 2;
        const lifetime = Math.random() * 40 + 30;
        
        particles.push(new Particle(x, y, vx, vy, color, size, lifetime, type === 'spark' ? 'spark' : 'glow'));
    }
}

// Enhanced Card system with environment cards and stacking
const CARDS = {
    common: [
        { 
            name: "Crescimento", 
            description: "+20% de dano", 
            stackable: true,
            effect: (level = 1) => gameState.playerStats.damage *= (1 + 0.2 * level),
            getDescription: (level) => `+${20 * level}% de dano`
        },
        { 
            name: "Velocidade", 
            description: "+1 velocidade", 
            stackable: true,
            effect: (level = 1) => gameState.playerStats.speed += level,
            getDescription: (level) => `+${level} velocidade`
        },
        { 
            name: "Vida", 
            description: "+20 vida máxima", 
            stackable: true,
            effect: (level = 1) => { 
                const bonus = 20 * level;
                gameState.playerStats.maxHealth += bonus; 
                player.health += bonus; 
            },
            getDescription: (level) => `+${20 * level} vida máxima`
        },
        { 
            name: "Cadência", 
            description: "-20% tempo entre tiros", 
            stackable: true,
            effect: (level = 1) => gameState.playerStats.fireRate *= Math.pow(0.8, level),
            getDescription: (level) => `-${Math.round((1 - Math.pow(0.8, level)) * 100)}% tempo entre tiros`
        }
    ],
    uncommon: [
        { 
            name: "Duplo Tiro", 
            description: "Dispara projéteis duplos", 
            stackable: true,
            effect: (level = 1) => gameState.playerStats.multishot += level,
            getDescription: (level) => `+${level} projéteis extras`
        },
        { 
            name: "Vida Vampira", 
            description: "Recupera 2 HP por kill", 
            stackable: true,
            effect: (level = 1) => gameState.playerStats.lifesteal += 2 * level,
            getDescription: (level) => `Recupera ${2 * level} HP por kill`
        },
        { 
            name: "Escudo", 
            description: "+25% redução de dano", 
            stackable: true,
            effect: (level = 1) => gameState.playerStats.damageReduction = Math.min(0.9, (gameState.playerStats.damageReduction || 0) + 0.25 * level),
            getDescription: (level) => `+${25 * level}% redução de dano`
        },
        { 
            name: "Rajada", 
            description: "+50% cadência de tiro", 
            stackable: true,
            effect: (level = 1) => gameState.playerStats.fireRate = Math.max(10, gameState.playerStats.fireRate * Math.pow(0.5, level)),
            getDescription: (level) => `+${Math.round((1 - Math.pow(0.5, level)) * 100)}% cadência de tiro`
        },
        { 
            name: "Ricochetear", 
            description: "Projéteis ricochetam 3x", 
            stackable: true,
            effect: (level = 1) => {
                gameState.playerStats.ricochet = true;
                gameState.playerStats.ricochetLevel = level;
            },
            getDescription: (level) => `Ricochetes Nv.${level} (${3 + level}x máx)`
        },
        { 
            name: "Fragmentação", 
            description: "Kills explodem em mini-tiros", 
            stackable: true,
            effect: (level = 1) => {
                gameState.playerStats.explosiveDeath = true;
                gameState.playerStats.explosiveDeathLevel = level;
            },
            getDescription: (level) => `${5 + level} mini-tiros por kill`
        },
        { 
            name: "Magnetismo", 
            description: "Atrai projéteis inimigos", 
            stackable: true,
            effect: (level = 1) => {
                gameState.playerStats.magnetism = true;
                gameState.playerStats.magnetismLevel = level;
            },
            getDescription: (level) => `Atração Nv.${level} (${20 + level * 10}px)`
        }
    ],
    epic: [
        { 
            name: "Barreira", 
            description: "Imune a dano por 5 segundos", 
            stackable: true,
            effect: (level = 1) => gameState.playerStats.invulnerable = 300 + (level - 1) * 150,
            getDescription: (level) => `Imune por ${5 + (level - 1) * 2.5}s`
        },
        { 
            name: "Explosão", 
            description: "Projéteis explodem ao impacto", 
            stackable: false,
            effect: () => gameState.playerStats.explosive = true,
            getDescription: () => "Projéteis explodem ao impacto"
        },
        { 
            name: "Penetração", 
            description: "Projéteis atravessam inimigos", 
            stackable: false,
            effect: () => gameState.playerStats.piercing = true,
            getDescription: () => "Projéteis atravessam inimigos"
        },
        { 
            name: "Gigante", 
            description: "+100% dano, +50% vida", 
            stackable: true,
            effect: (level = 1) => { 
                gameState.playerStats.damage *= Math.pow(2, level); 
                gameState.playerStats.maxHealth *= Math.pow(1.5, level); 
                player.health *= Math.pow(1.5, level); 
            },
            getDescription: (level) => `+${Math.round((Math.pow(2, level) - 1) * 100)}% dano, +${Math.round((Math.pow(1.5, level) - 1) * 100)}% vida`
        },
        { 
            name: "Berserker", 
            description: "Mais dano com menos vida", 
            stackable: true,
            effect: (level = 1) => {
                gameState.playerStats.berserker = true;
                gameState.playerStats.berserkerLevel = level;
            },
            getDescription: (level) => `+${50 * level}% dano por 25% vida perdida`
        },
        { 
            name: "Temporal", 
            description: "Congela inimigos por 3s", 
            stackable: true,
            effect: (level = 1) => {
                gameState.playerStats.timeFreeze = true;
                gameState.playerStats.timeFreezeLevel = level;
                gameState.playerStats.timeFreezeChance = 0.1 * level; // 10% per level
            },
            getDescription: (level) => `${10 * level}% chance de congelar por ${3 + level}s`
        },
        { 
            name: "Vampírico", 
            description: "Projéteis drenam vida inimiga", 
            stackable: true,
            effect: (level = 1) => {
                gameState.playerStats.vampiricShots = true;
                gameState.playerStats.vampiricLevel = level;
            },
            getDescription: (level) => `Drena ${5 * level}% do dano como vida`
        }
    ],
    legendary: [
        {
            name: "Will-o-Wisp",
            description: "Companion que atira sozinho",
            stackable: true,
            effect: (level = 1) => {
                if (!gameState.playerStats.willOWisp) {
                    gameState.playerStats.willOWisp = new WillOWisp(player);
                }
                gameState.playerStats.willOWisp.level = level;
                gameState.playerStats.willOWisp.shootRate = Math.max(200, 800 - (level - 1) * 150);
            },
            getDescription: (level) => `Wisp Nv.${level} atira a cada ${(800 - (level - 1) * 150)/1000}s`
        },
        {
            name: "Raios",
            description: "Raios caem do céu a cada 2s",
            stackable: true,
            effect: (level = 1) => {
                gameState.environmentEffects.lightning.active = true;
                gameState.environmentEffects.lightning.level = level;
            },
            getDescription: (level) => `Raios Nv.${level} caem a cada ${Math.max(1, 2 - level * 0.25)}s`
        },
        {
            name: "Meteoritos",
            description: "Meteoritos atingem inimigos",
            stackable: true,
            effect: (level = 1) => {
                gameState.environmentEffects.meteor.active = true;
                gameState.environmentEffects.meteor.level = level;
            },
            getDescription: (level) => `Meteoritos Nv.${level} caem mais frequentemente`
        },
        {
            name: "Espinhos",
            description: "Espinhos emergem do solo",
            stackable: true,
            effect: (level = 1) => {
                gameState.environmentEffects.thorns.active = true;
                gameState.environmentEffects.thorns.level = level;
            },
            getDescription: (level) => `Espinhos Nv.${level} causam mais dano`
        },
        {
            name: "Veneno",
            description: "Nuvens tóxicas aparecem",
            stackable: true,
            effect: (level = 1) => {
                gameState.environmentEffects.poison.active = true;
                gameState.environmentEffects.poison.level = level;
            },
            getDescription: (level) => `Veneno Nv.${level} mais letal`
        },
        {
            name: "Fogo",
            description: "Pilares de fogo emergem",
            stackable: true,
            effect: (level = 1) => {
                gameState.environmentEffects.fire.active = true;
                gameState.environmentEffects.fire.level = level;
            },
            getDescription: (level) => `Fogo Nv.${level} queima mais tempo`
        },
        {
            name: "Nexus",
            description: "Portal que spawna aliados",
            stackable: true,
            effect: (level = 1) => {
                gameState.playerStats.nexus = true;
                gameState.playerStats.nexusLevel = level;
            },
            getDescription: (level) => `${level} aliados ativos, respawn a cada ${Math.max(5, 15 - level * 2)}s`
        },
        {
            name: "Ascensão",
            description: "Voa e atira para baixo",
            stackable: true,
            effect: (level = 1) => {
                gameState.playerStats.ascension = true;
                gameState.playerStats.ascensionLevel = level;
            },
            getDescription: (level) => `Voa ${100 + level * 50}px alto, +${25 * level}% dano aéreo`
        }
    ]
};

// Drawing functions
// Terrain height data - stores the actual ground height at each x position
let terrainHeights = [];
let currentTerrainHeights = [];
let nextTerrainHeights = [];
let terrainTransition = { active: false, progress: 0, duration: 3000 }; // 3 seconds transition

// Simple noise function for terrain generation
function simpleNoise(x, seed = 1) {
    x = (x + seed) * 0.01;
    return Math.sin(x) * 0.5 + Math.sin(x * 2.1) * 0.25 + Math.sin(x * 4.3) * 0.125;
}

function generateTerrainHeights(seed) {
    const groundY = CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT;
    const heights = [];
    
    // Create procedural terrain with only upward variations (hills)
    for (let x = 0; x <= CONFIG.CANVAS_WIDTH; x += 10) {
        // Generate noise-based height variations
        const noise1 = simpleNoise(x * 0.5, seed);
        const noise2 = simpleNoise(x * 0.2, seed + 100);
        const noise3 = simpleNoise(x * 0.8, seed + 200);
        
        // Combine different frequencies for natural-looking terrain
        const combinedNoise = noise1 * 0.6 + noise2 * 0.3 + noise3 * 0.1;
        
        // Only positive heights (hills above ground level)
        const height = Math.max(0, combinedNoise * 60); // Max 60px hills
        
        heights.push(groundY - height); // Subtract to make hills go up
    }
    
    return heights;
}

function initializeTerrain() {
    // Generate initial terrain
    const terrainSeed = Math.random() * 1000;
    terrainHeights = generateTerrainHeights(terrainSeed);
    currentTerrainHeights = [...terrainHeights]; // Copy current terrain
    
    console.log(`Generated initial terrain with seed: ${terrainSeed.toFixed(2)}`);
}

function startTerrainTransition() {
    if (terrainTransition.active) return; // Don't start if already transitioning
    
    // Generate new terrain for next wave
    const newSeed = Math.random() * 1000;
    nextTerrainHeights = generateTerrainHeights(newSeed);
    
    // Start transition
    terrainTransition.active = true;
    terrainTransition.progress = 0;
    
    console.log(`Starting terrain transition to seed: ${newSeed.toFixed(2)}`);
}

function updateTerrainTransition(deltaTime) {
    if (!terrainTransition.active) return;
    
    // Update transition progress
    terrainTransition.progress += deltaTime;
    const t = Math.min(terrainTransition.progress / terrainTransition.duration, 1);
    
    // Smooth easing function (ease-in-out)
    const easedT = t * t * (3 - 2 * t);
    
    // Interpolate between current and next terrain
    for (let i = 0; i < terrainHeights.length; i++) {
        terrainHeights[i] = currentTerrainHeights[i] + 
            (nextTerrainHeights[i] - currentTerrainHeights[i]) * easedT;
    }
    
    // Check if transition is complete
    if (t >= 1) {
        terrainTransition.active = false;
        currentTerrainHeights = [...nextTerrainHeights]; // Update current terrain
        console.log('Terrain transition completed');
    }
}

function getTerrainHeightAt(x) {
    const index = Math.floor(x / 10); // Updated to match new resolution
    if (index < 0) return terrainHeights[0];
    if (index >= terrainHeights.length) return terrainHeights[terrainHeights.length - 1];
    return terrainHeights[index];
}

function drawBackground() {
    // Pure black sky
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT);
    
    // Create terrain shape with smooth uneven ground
    const terrainPoints = [];
    
    // Start from the leftmost point
    terrainPoints.push({ x: 0, y: getTerrainHeightAt(0) });
    
    // Create points every 10 pixels for smoother curves
    for (let x = 10; x <= CONFIG.CANVAS_WIDTH; x += 10) {
        const terrainHeight = getTerrainHeightAt(x);
        terrainPoints.push({ x: x, y: terrainHeight });
    }
    
    // Ensure we end at the rightmost point
    if (terrainPoints[terrainPoints.length - 1].x < CONFIG.CANVAS_WIDTH) {
        terrainPoints.push({ x: CONFIG.CANVAS_WIDTH, y: getTerrainHeightAt(CONFIG.CANVAS_WIDTH) });
    }
    
    // Draw terrain with white-to-black gradient
    const gradient = ctx.createLinearGradient(0, CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT - 50, 0, CONFIG.CANVAS_HEIGHT);
    gradient.addColorStop(0, '#ffffff'); // White at top
    gradient.addColorStop(1, '#000000'); // Black at bottom
    
    ctx.fillStyle = gradient;
    
    // Draw the terrain shape with smooth curves
    ctx.beginPath();
    
    // Start from top-left corner of the terrain area
    ctx.moveTo(0, terrainPoints[0].y);
    
    // Draw smooth curves through all terrain points
    for (let i = 1; i < terrainPoints.length; i++) {
        const currentPoint = terrainPoints[i];
        const prevPoint = terrainPoints[i - 1];
        
        // Use quadratic curves for smoother terrain
        const controlX = (prevPoint.x + currentPoint.x) / 2;
        const controlY = (prevPoint.y + currentPoint.y) / 2;
        
        ctx.quadraticCurveTo(controlX, controlY, currentPoint.x, currentPoint.y);
    }
    
    // Complete the shape to bottom of canvas
    ctx.lineTo(CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
    ctx.lineTo(0, CONFIG.CANVAS_HEIGHT);
    ctx.closePath();
    ctx.fill();
}

function drawCrosshair() {
    if (mouse.x && mouse.y) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = mouse.x * (CONFIG.CANVAS_WIDTH / rect.width);
        const mouseY = mouse.y * (CONFIG.CANVAS_HEIGHT / rect.height);
        
        // Draw crosshair
        ctx.strokeStyle = mouse.clicked ? '#cccccc' : '#ffffff';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        
        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(mouseX - 10, mouseY);
        ctx.lineTo(mouseX + 10, mouseY);
        ctx.stroke();
        
        // Vertical line
        ctx.beginPath();
        ctx.moveTo(mouseX, mouseY - 10);
        ctx.lineTo(mouseX, mouseY + 10);
        ctx.stroke();
        
        // Center dot
        ctx.fillStyle = mouse.clicked ? '#cccccc' : '#ffffff';
        ctx.fillRect(mouseX - 1, mouseY - 1, 2, 2);
        
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
    }
}

function drawOwnedCards() {
    if (gameState.ownedCards.length === 0) return;
    
    const cardSize = 32;
    const cardSpacing = 36;
    const startX = 10;
    const startY = CONFIG.CANVAS_HEIGHT - cardSize - 10;
    
    // Card symbols mapping
    const symbols = {
        'Crescimento':'🗡️','Velocidade':'⚡','Vida':'❤️','Cadência':'🔫',
        'Duplo Tiro':'🎯','Vida Vampira':'🧛','Escudo':'🛡️','Rajada':'💥',
        'Ricochetear':'🔄','Fragmentação':'💥','Magnetismo':'🧲',
        'Barreira':'🔒','Explosão':'💣','Penetração':'↔️','Gigante':'👹',
        'Berserker':'😡','Temporal':'❄️','Vampírico':'🩸',
        'Will-o-Wisp':'👻','Raios':'⚡','Meteoritos':'☄️','Espinhos':'🌵',
        'Veneno':'☠️','Fogo':'🔥','Nexus':'🌀','Ascensão':'🕊️'
    };
    
    for (let i = 0; i < gameState.ownedCards.length; i++) {
        const card = gameState.ownedCards[i];
        const x = startX + i * cardSpacing;
        const y = startY;
        
        // Card background (black with white border)
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y, cardSize, cardSize);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cardSize, cardSize);
        
        // Card symbol (emoji/text in center)
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px "Press Start 2P", Arial, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const symbol = symbols[card.name] || '✨';
        ctx.fillText(symbol, x + cardSize/2, y + cardSize/2);
        
        // Card level indicator (small number in top-right corner)
        if (card.level && card.level > 1) {
            ctx.fillStyle = '#ffff00'; // Yellow for level
            ctx.font = '8px "Press Start 2P", Arial, monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(card.level.toString(), x + cardSize - 2, y + 2);
        }
        
        // Card rarity indicator (small line at bottom)
        ctx.fillStyle = card.rarity === 'legendary' ? '#ff8800' : 
                       card.rarity === 'epic' ? '#aa44ff' : 
                       card.rarity === 'uncommon' ? '#44ff44' : '#ffffff';
        const lineWidth = card.rarity === 'legendary' ? cardSize : 
                         card.rarity === 'epic' ? cardSize * 0.8 : 
                         card.rarity === 'uncommon' ? cardSize * 0.6 : cardSize * 0.4;
        ctx.fillRect(x + (cardSize - lineWidth)/2, y + cardSize - 3, lineWidth, 2);
    }
    
    // Reset text styles
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}



// Game functions
function initGame() {
    player = new Player(CONFIG.CANVAS_WIDTH / 2, CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT - 50);
    bullets = [];
    enemies = [];
    enemies.bullets = [];
    drops = [];
    damageIndicators = [];
    // No particles system
    effects = [];
    
    // Clear environment effects
    environmentObjects = {
        lightning: [],
        meteors: [],
        thorns: [],
        poisonClouds: [],
        firePillars: []
    };
    
    // Reset environment effects state and game time
    gameState.gameTime = 0; // Reset game time for consistent timing
    gameState.lastTime = 0;
    gameState.environmentEffects = {
        lightning: { active: false, level: 0, lastTrigger: 0 },
        meteor: { active: false, level: 0, lastTrigger: 0 },
        thorns: { active: false, level: 0, lastTrigger: 0 },
        poison: { active: false, level: 0, lastTrigger: 0 },
        fire: { active: false, level: 0, lastTrigger: 0 }
    };
    
    // Initialize terrain
    initializeTerrain();
    
    // Initialize game state
    gameState.wave = 1;
    gameState.score = 0;
    gameState.xp = 0;
    gameState.level = 1;
    gameState.xpToNext = 100;
    gameState.totalXpForLevel = 100;
    gameState.waveStartTime = 0;
    gameState.lastEnemySpawn = 0;
    gameState.enemySpawnRate = 800;
    gameState.ownedCards = []; // Clear owned cards for new game
    
    // Apply hat effects
    applyHatEffects();
    
    updateUI();
}

function applyHatEffects() {
    const hats = {
        wizard: () => {}, // No effect
        helmet: () => {
            gameState.playerStats.maxHealth *= 1.5;
            gameState.playerStats.speed *= 0.8;
            player.health = gameState.playerStats.maxHealth;
        },
        propeller: () => {
            gameState.playerStats.speed *= 1.3;
        },
        challenger: () => {
            gameState.playerStats.damage *= 1.2;
        }
    };

    if (hats[gameState.selectedHat]) {
        hats[gameState.selectedHat]();
    }
}

function startNewWave() {
    // Log wave completion
    if (gameState.wave > 1) {
        // Check if wave was completed early (all enemies killed)
        const allEnemiesSpawned = gameState.enemiesSpawnedThisWave >= gameState.maxEnemiesThisWave;
        const allEnemiesKilled = enemies.length === 0 && allEnemiesSpawned;
        
        if (allEnemiesKilled) {
            console.log(`Wave ${gameState.wave - 1} completed early! All enemies defeated.`);
        } else {
            console.log(`Wave ${gameState.wave - 1} completed!`);
        }
    }
    
    gameState.wave++;
    gameState.waveStartTime = gameState.gameTime;
    gameState.lastEnemySpawn = gameState.gameTime;
    
    // More aggressive difficulty scaling
    gameState.enemySpawnRate = Math.max(150, 800 - (gameState.wave * 50)); // Much faster spawning each wave
    
    // Set maximum enemies for this wave - 2 more enemies per wave
    gameState.maxEnemiesThisWave = 1 + (gameState.wave); // Starts with 5 enemies (wave 1), +2 per wave
    gameState.enemiesSpawnedThisWave = 0; // Reset counter
    
    console.log(`Wave ${gameState.wave} started! Spawn rate: ${gameState.enemySpawnRate}ms, Max enemies: ${gameState.maxEnemiesThisWave}`);
    
    // Start terrain transition for each new wave (except wave 1)
    if (gameState.wave > 1) {
        startTerrainTransition();
    }
    
    // Show card selection at the start of each new wave (except wave 1)
    if (gameState.wave > 1) {
        showCardSelection();
    }
}

function spawnEnemy() {
    // Don't spawn if we already have too many enemies or reached wave limit
    const maxEnemies = Math.min(CONFIG.MAX_ENEMIES + Math.floor(gameState.wave / 3), 30);
    if (enemies.length >= maxEnemies) return;
    
    // Check if we've reached the maximum for this wave
    if (gameState.enemiesSpawnedThisWave >= gameState.maxEnemiesThisWave) return;
    
    // All enemies spawn from top of screen
    const x = Math.random() * (CONFIG.CANVAS_WIDTH - 100) + 50;
    const y = -40;
    
    const enemy = new Enemy(x, y);
    enemy.spawnTime = gameState.gameTime;
    
    // Base enemy scaling with wave - much more gentle scaling
    const waveMultiplier = 1 + (gameState.wave - 1) * 0.15; // 15% per wave (was 30%)
    const speedMultiplier = 1 + (gameState.wave - 1) * 0.05; // Speed scaling (was 0.08)
    const shootRateMultiplier = Math.max(0.6, 1 - (gameState.wave - 1) * 0.03); // Faster shooting each wave (was 0.04)
    
    // Scale all enemy stats
    enemy.health = Math.floor(enemy.health * waveMultiplier);
    enemy.maxHealth = enemy.health;
    enemy.damage = Math.floor(enemy.damage * waveMultiplier);
    enemy.points = Math.floor(enemy.points * waveMultiplier);
    enemy.speed = Math.min(enemy.speed * speedMultiplier, CONFIG.ENEMY_SPEED * 2.5); // Cap speed
    enemy.shootRate = Math.floor(enemy.shootRate * shootRateMultiplier); // Faster shooting
    enemy.bulletSpeed = Math.min(enemy.bulletSpeed + (gameState.wave - 1) * 0.2, 7); // Faster bullets
    
    // Mark some enemies with guaranteed drops and special colors (before elite/boss assignment)
    const dropChance = Math.random();
    if (dropChance < 0.15) { // 15% chance for special drop enemies
        const dropType = Math.random();
        if (dropType < 0.4) { // 40% of special enemies drop health (green)
            enemy.guaranteedDrop = 'health';
            enemy.color = '#00ff00'; // Green for health
        } else if (dropType < 0.7) { // 30% drop chest (orange)
            enemy.guaranteedDrop = 'chest';
            enemy.color = '#ffaa00'; // Orange for chest
        } else if (dropType < 0.9) { // 20% drop bomb (red)
            enemy.guaranteedDrop = 'bomb';
            enemy.color = '#ff4444'; // Red for bomb
        } else { // 10% drop card (purple)
            enemy.guaranteedDrop = 'card';
            enemy.color = '#aa44ff'; // Purple for card
        }
    }
    
    // Determine enemy type based on wave and spawn count
    let enemyType = 'normal';
    
    // Boss every 15 waves (15, 30, 45, etc.)
    if (gameState.wave % 15 === 0 && gameState.enemiesSpawnedThisWave === gameState.maxEnemiesThisWave - 1) {
        enemyType = 'boss';
    }
    // Elite every 10 waves (10, 20, 25, 35, 40, etc.) - but not on boss waves
    else if (gameState.wave % 10 === 0 && gameState.wave % 15 !== 0 && gameState.enemiesSpawnedThisWave === gameState.maxEnemiesThisWave - 1) {
        enemyType = 'elite';
    }
    // Additional elite on waves 5, 25, 35, etc. (every 10 waves + 5)
    else if ((gameState.wave - 5) % 10 === 0 && gameState.wave % 15 !== 0 && gameState.enemiesSpawnedThisWave === gameState.maxEnemiesThisWave - 1) {
        enemyType = 'elite';
    }
    
    // Apply enemy type modifications
    if (enemyType === 'elite') {
        enemy.health *= 3.5; // Elite has 3.5x health (increased from 2.5x)
        enemy.maxHealth = enemy.health;
        enemy.damage *= 2.2; // Elite does 2.2x damage (increased from 1.8x)
        enemy.points *= 4; // Elite gives 4x points (increased from 3x)
        enemy.width *= 1.3;
        enemy.height *= 1.3;
        enemy.shootRate *= 0.6; // Elite shoots faster (was 0.7)
        // Only set elite color if no guaranteed drop color is set
        if (!enemy.guaranteedDrop) {
            enemy.color = '#ffaa44'; // Orange color for elite
        }
        console.log(`Elite enemy spawned on wave ${gameState.wave}!`);
    } else if (enemyType === 'boss') {
        enemy.health *= 7; // Boss has 7x health (increased from 5x)
        enemy.maxHealth = enemy.health;
        enemy.damage *= 4; // Boss does 4x damage (increased from 3x)
        enemy.points *= 12; // Boss gives 12x points (increased from 8x)
        enemy.width *= 1.8;
        enemy.height *= 1.8;
        enemy.shootRate *= 0.3; // Boss shoots much faster (was 0.4)
        enemy.bulletSpeed *= 1.5; // Boss bullets are faster
        // Only set boss color if no guaranteed drop color is set
        if (!enemy.guaranteedDrop) {
            enemy.color = '#ff4444'; // Red color for boss
        }
        console.log(`Boss enemy spawned on wave ${gameState.wave}!`);
    }
    
    enemies.push(enemy);
    gameState.enemiesSpawnedThisWave++; // Increment counter
}

function showCardSelection() {
    const modal = document.getElementById('cardSelection');
    const container = document.getElementById('cardContainer');
    container.innerHTML = '';

    // Level-based card pool progression
    const cardPool = [];
    if (gameState.level >= 20) {
        // High level: All rarities available
        cardPool.push(...CARDS.legendary, ...CARDS.epic, ...CARDS.uncommon, ...CARDS.common);
    } else if (gameState.level >= 15) {
        // Mid-high level: Epic and below
        cardPool.push(...CARDS.epic, ...CARDS.uncommon, ...CARDS.common);
    } else if (gameState.level >= 10) {
        // Mid level: Uncommon and below
        cardPool.push(...CARDS.uncommon, ...CARDS.common);
    } else if (gameState.level >= 5) {
        // Early-mid level: Mostly common with some uncommon
        cardPool.push(...CARDS.common, ...CARDS.uncommon.slice(0, 2));
    } else {
        // Early level: Only common cards
        cardPool.push(...CARDS.common);
    }

    // Shuffle the card pool and select 3 unique cards
    const shuffledCards = [...cardPool].sort(() => Math.random() - 0.5);
    const selectedCards = shuffledCards.slice(0, Math.min(3, shuffledCards.length));

    selectedCards.forEach((card) => {
        const cardElement = document.createElement('div');
        
        // Determine rarity for CSS class and card data
        let rarity = 'common';
        if (CARDS.legendary.includes(card)) rarity = 'legendary';
        else if (CARDS.epic.includes(card)) rarity = 'epic';
        else if (CARDS.uncommon.includes(card)) rarity = 'uncommon';
        
        cardElement.className = `card ${rarity}`;
        
        // Check if player already owns this card
        const ownedCard = gameState.ownedCards.find(owned => owned.name === card.name);
        const currentLevel = ownedCard ? ownedCard.level : 0;
        const nextLevel = currentLevel + 1;
        
        // Enhanced symbols with new legendary cards
        const symbols = {
            'Crescimento':'🗡️','Velocidade':'⚡','Vida':'❤️','Cadência':'🔫',
            'Duplo Tiro':'🎯','Vida Vampira':'🧛','Escudo':'🛡️','Rajada':'💥',
            'Ricochetear':'🔄','Fragmentação':'💥','Magnetismo':'🧲',
            'Barreira':'🔒','Explosão':'💣','Penetração':'↔️','Gigante':'👹',
            'Berserker':'😡','Temporal':'❄️','Vampírico':'🩸',
            'Will-o-Wisp':'👻','Raios':'⚡','Meteoritos':'☄️','Espinhos':'🌵',
            'Veneno':'☠️','Fogo':'🔥','Nexus':'🌀','Ascensão':'🕊️'
        };
        const sym = symbols[card.name] || '✨';
        
        // Get appropriate description
        let description = card.description;
        if (card.getDescription) {
            description = card.getDescription(nextLevel);
        }
        
        // Build level info
        let levelInfo = '';
        if (ownedCard && card.stackable) {
            levelInfo = `<div class="card-level">Nível ${currentLevel} → ${nextLevel}</div>`;
        } else if (!card.stackable && ownedCard) {
            levelInfo = `<div class="card-owned">JÁ POSSUÍDA</div>`;
        }
        
        cardElement.innerHTML = `
            <div class="card-header">
                <div class="card-title">${card.name}</div>
                <div class="card-rarity ${rarity}">${rarity.toUpperCase()}</div>
            </div>
            <div class="card-symbol" style="font-size:28px;text-align:center;font-family:'Press Start 2P',monospace;margin:8px 0;">${sym}</div>
            <div class="card-description">${description}</div>
            ${levelInfo}
        `;
        
        // Handle card selection with stacking system
        const canPurchase = card.stackable || !ownedCard;
        if (!canPurchase) {
            cardElement.style.opacity = '0.5';
            cardElement.style.cursor = 'not-allowed';
        } else {
            cardElement.addEventListener('click', () => {
                // Check if upgrading existing card
                if (ownedCard && card.stackable) {
                    ownedCard.level = nextLevel;
                    card.effect(nextLevel);
                } else {
                    // Add new card
                    const cardWithInfo = {
                        name: card.name,
                        rarity: rarity,
                        level: 1
                    };
                    gameState.ownedCards.push(cardWithInfo);
                    card.effect(1);
                }
                
                modal.classList.add('hidden');
                gameState.paused = false;
            });
        }
        
        container.appendChild(cardElement);
    });

    modal.classList.remove('hidden');
    gameState.paused = true;
}

// XP System Functions - Removed since we now use wave-based card selection
// function giveXP(amount) {
//     gameState.xp += amount;
//     
//     // Check for level up
//     while (gameState.xp >= gameState.xpToNext) {
//         levelUp();
//     }
// }

// function levelUp() {
//     gameState.xp -= gameState.xpToNext;
//     gameState.level++;
//     
//     // Calculate next level XP requirement (exponential growth)
//     gameState.totalXpForLevel = Math.floor(100 * Math.pow(1.2, gameState.level - 1));
//     gameState.xpToNext = gameState.totalXpForLevel;
//     
//     // Show level up selection
//     showCardSelection();
//     
//     // Play level up sound
//     playSound(600, 0.3, 'triangle');
// }

function updateUI() {
    document.getElementById('healthText').textContent = `${Math.max(0, Math.floor(player.health))}/${gameState.playerStats.maxHealth}`;
    document.getElementById('healthFill').style.width = `${(player.health / gameState.playerStats.maxHealth) * 100}%`;
    
    // Update wave counter
    document.getElementById('waveText').textContent = `Onda: ${gameState.wave}`;
}

function endGame() {
    gameState.running = false;
    gameState.souls += Math.floor(gameState.score / 100);
    
    document.getElementById('finalScore').textContent = `Pontuação Final: ${gameState.score}`;
    document.getElementById('finalWave').textContent = `Onda Alcançada: ${gameState.wave}`;
    document.getElementById('soulsEarned').textContent = `Almas Ganhas: ${Math.floor(gameState.score / 100)}`;
    
    // Reset ranking UI completamente
    resetRankingUI();
    
    document.getElementById('gameOver').classList.remove('hidden');
}

// Função para resetar completamente a UI do ranking
function resetRankingUI() {
    const nameInput = document.getElementById('nameInput');
    const scoreSubmitted = document.getElementById('scoreSubmitted');
    const playerName = document.getElementById('playerName');
    const submitBtn = document.getElementById('submitScore');
    
    // Mostrar seção de input e esconder confirmação
    nameInput.classList.remove('hidden');
    scoreSubmitted.classList.add('hidden');
    
    // Limpar campo de nome
    playerName.value = '';
    
    // Resetar botão de envio
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar Pontuação';
    
    // Resetar flag de envio
    gameState.scoreSubmitted = false;
    
    console.log('UI do ranking resetada');
}

function gameLoop() {
    if (!gameState.running || gameState.paused) {
        requestAnimationFrame(gameLoop);
        return;
    }

    // Calculate delta time and update game time
    const currentTime = performance.now();
    const deltaTime = gameState.lastTime ? currentTime - gameState.lastTime : 0;
    gameState.lastTime = currentTime;
    gameState.gameTime += deltaTime;

    // Update terrain transition
    updateTerrainTransition(deltaTime);

    // Draw background
    drawBackground();

    // Update entities with optimizations
    player.update(deltaTime, gameState.gameTime);
    
    // Update Will-o-Wisp companion
    if (gameState.playerStats.willOWisp) {
        gameState.playerStats.willOWisp.update(gameState.gameTime);
    }
    
    // Optimized bullet management
    bullets = bullets.filter(bullet => bullet.update());
    if (bullets.length > CONFIG.MAX_BULLETS) {
        bullets = bullets.slice(-CONFIG.MAX_BULLETS); // Keep only recent bullets
    }
    
    // Update enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        enemy.update();
        
        if (enemy.killed) {
            enemies.splice(i, 1);
        }
    }
    
    // Update drops
    drops = drops.filter(drop => drop.update());
    
    // Update damage indicators
    damageIndicators = damageIndicators.filter(indicator => indicator.update());
    
    // Update particles
    particles = particles.filter(particle => particle.update());
    
    // Clean up any remaining enemy bullets (they're disabled now)
    if (enemies.bullets) {
        enemies.bullets = enemies.bullets.filter(bullet => bullet.update());
    }
    
    // Limit max enemies for performance
    if (enemies.length > CONFIG.MAX_ENEMIES) {
        enemies = enemies.slice(0, CONFIG.MAX_ENEMIES);
    }
    
    // Process environment effects
    processEnvironmentEffects(gameState.gameTime);
    
    // Wave management - time-based system with early completion
    const timeSinceWaveStart = gameState.gameTime - gameState.waveStartTime;
    
    // Check if current wave should end
    // Either by time (60 seconds) OR by killing all enemies when spawn limit is reached
    const allEnemiesSpawned = gameState.enemiesSpawnedThisWave >= gameState.maxEnemiesThisWave;
    const allEnemiesKilled = enemies.length === 0 && allEnemiesSpawned;
    
    if (timeSinceWaveStart >= gameState.waveDuration || allEnemiesKilled) {
        if (allEnemiesKilled) {
            console.log(`Wave ${gameState.wave} completed early! All enemies defeated.`);
        }
        startNewWave();
    }
    
    // Spawn enemies continuously during wave (only if not reached limit)
    if (gameState.gameTime - gameState.lastEnemySpawn >= gameState.enemySpawnRate && 
        gameState.enemiesSpawnedThisWave < gameState.maxEnemiesThisWave) {
        spawnEnemy();
        gameState.lastEnemySpawn = gameState.gameTime;
    }

    // Optimized drawing - batch operations
    // Draw environment effects
    environmentObjects.lightning.forEach(obj => obj.draw());
    environmentObjects.meteors.forEach(obj => obj.draw());
    environmentObjects.thorns.forEach(obj => obj.draw());
    environmentObjects.poisonClouds.forEach(obj => obj.draw());
    environmentObjects.firePillars.forEach(obj => obj.draw());
    
    // Draw bullets in batch
    bullets.forEach(bullet => bullet.draw());
    
    // Enemy bullets now enabled - red projectiles
    if (enemies.bullets && enemies.bullets.length > 0) {
        enemies.bullets.forEach(bullet => bullet.draw());
    }
    
    // Draw enemies
    enemies.forEach(enemy => enemy.draw());
    
    // Draw drops
    drops.forEach(drop => drop.draw());
    
    // Draw player
    player.draw();
    
    // Draw Will-o-Wisp companion
    if (gameState.playerStats.willOWisp) {
        gameState.playerStats.willOWisp.draw();
    }
    
    // Draw damage indicators
    damageIndicators.forEach(indicator => indicator.draw());
    
    // Draw particles
    particles.forEach(particle => particle.draw());

    // Draw UI elements
    drawCrosshair();
    drawOwnedCards();
    
    // Update UI less frequently for performance
    if (Math.floor(gameState.gameTime / 100) % 2 === 0) {
        updateUI();
    }

    requestAnimationFrame(gameLoop);
}

// Event listeners
document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
});

document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
});

canvas.addEventListener('mousedown', (e) => {
    mouse.clicked = true;
});

canvas.addEventListener('mouseup', (e) => {
    mouse.clicked = false;
});

canvas.addEventListener('mouseleave', (e) => {
    mouse.clicked = false;
});

// Class and trait data for the new interface
const classData = {
    wizard: {
        name: 'Mago de Batalha',
        icon: '🪄',
        description: 'Um guerreiro-mago equilibrado com habilidades de combate confiáveis. Domina os fundamentos da guerra mágica com dano consistente.',
        damage: '100%',
        special: 'Tiro Normal',
        health: '100%',
        speed: '100%'
    },
    emerald: {
        name: 'Rastreador',
        icon: '💚',
        description: 'Utiliza magia rastreadora que busca inimigos. Dano ligeiramente reduzido, mas projéteis seguem alvos automaticamente.',
        damage: '85%',
        special: 'Rastreamento',
        health: '100%',
        speed: '100%'
    },
    trident: {
        name: 'Destruidor',
        icon: '🔱',
        description: 'Dispara três projéteis em padrão espalhado. Dano individual menor, mas excelente cobertura de área.',
        damage: '75%',
        special: 'Tiro Triplo',
        health: '100%',
        speed: '100%'
    },
    boom: {
        name: 'Demolidor',
        icon: '💥',
        description: 'Especialista explosivo com ataques de área de alto dano. Projéteis explodem no impacto causando dano em área.',
        damage: '130%',
        special: 'Explosivo',
        health: '100%',
        speed: '100%'
    }
};

const traitData = {
    wizard: {
        name: 'Equilibrado',
        icon: '🎩',
        description: 'Configuração padrão sem modificadores especiais. Uma escolha confiável para desempenho consistente.',
        health: '+0%',
        speed: '+0%',
        damage: '+0%'
    },
    helmet: {
        name: 'Guardião',
        icon: '⛑️',
        description: 'Capacidades defensivas aprimoradas. Vida significativamente aumentada para sobrevivência prolongada.',
        health: '+50%',
        speed: '+0%',
        damage: '+0%'
    },
    propeller: {
        name: 'Veloz',
        icon: '🚁',
        description: 'Mobilidade aprimorada para táticas de ataque e fuga. Velocidade de movimento dobrada para posicionamento superior.',
        health: '+0%',
        speed: '+100%',
        damage: '+0%'
    },
    challenger: {
        name: 'Berserker',
        icon: '👑',
        description: 'Estilo de combate de alto risco e alta recompensa. Dano aumentado ao custo de sobrevivência reduzida.',
        health: '-25%',
        speed: '+0%',
        damage: '+50%'
    }
};

// Update display function
function updateDisplay(type, key) {
    const data = type === 'class' ? classData[key] : traitData[key];
    const portrait = document.getElementById('characterPortrait');
    const descText = document.getElementById('descriptionText');
    const statsSection = document.getElementById('statsSection');
    
    portrait.innerHTML = data.icon;
    descText.innerHTML = `<p><strong>${data.name}</strong></p><p>${data.description}</p>`;
    
    if (type === 'class') {
        document.getElementById('statDamage').textContent = data.damage;
        document.getElementById('statSpecial').textContent = data.special;
        document.getElementById('statHealth').textContent = data.health;
        document.getElementById('statSpeed').textContent = data.speed;
        statsSection.style.display = 'block';
    } else {
        // Show trait stats
        document.getElementById('statDamage').textContent = data.damage;
        document.getElementById('statSpecial').textContent = '-';
        document.getElementById('statHealth').textContent = data.health;
        document.getElementById('statSpeed').textContent = data.speed;
        statsSection.style.display = 'block';
    }
}

function checkSelections() {
    const startBtn = document.getElementById('startGame');
    const nightmareBtn = document.getElementById('nightmareChallenge');
    if (gameState.selectedStaff && gameState.selectedHat) {
        startBtn.disabled = false;
        nightmareBtn.disabled = false;
    } else {
        startBtn.disabled = true;
        nightmareBtn.disabled = true;
    }
}

function initNightmareMode() {
    // Initialize game with nightmare settings
    initGame();
    
    // Set nightmare wave and stats
    gameState.wave = 50;
    gameState.enemySpawnRate = Math.max(150, 800 - (gameState.wave * 50));
    gameState.maxEnemiesThisWave = 1 + gameState.wave;
    
    // Give nightmare starter items
    const nightmareCards = [
        // Powerful defensive cards
        { name: "Vida", level: 5 },
        { name: "Escudo", level: 3 },
        { name: "Velocidade", level: 3 },
        
        // Strong offensive cards
        { name: "Crescimento", level: 4 },
        { name: "Cadência", level: 3 },
        { name: "Duplo Tiro", level: 2 },
        
        // Special abilities
        { name: "Explosão", level: 1 },
        { name: "Penetração", level: 1 },
        { name: "Vida Vampira", level: 2 },
        
        // Advanced cards
        { name: "Ricochetear", level: 2 },
        { name: "Fragmentação", level: 1 },
        { name: "Berserker", level: 1 }
    ];
    
    // Apply all nightmare cards
    nightmareCards.forEach(cardInfo => {
        // Find the card definition
        const allCards = [...CARDS.common, ...CARDS.uncommon, ...CARDS.epic, ...CARDS.legendary];
        const cardDef = allCards.find(card => card.name === cardInfo.name);
        
        if (cardDef) {
            // Add to owned cards
            gameState.ownedCards.push({
                name: cardInfo.name,
                rarity: getCardRarity(cardDef),
                level: cardInfo.level
            });
            
            // Apply effects
            cardDef.effect(cardInfo.level);
        }
    });
    
    // Extra nightmare bonuses
    gameState.playerStats.maxHealth = Math.floor(gameState.playerStats.maxHealth * 1.5); // +50% max health
    player.health = gameState.playerStats.maxHealth; // Full heal
    gameState.playerStats.damage = Math.floor(gameState.playerStats.damage * 1.3); // +30% damage
    
    console.log(`Nightmare Challenge iniciado! Onda ${gameState.wave} com ${gameState.ownedCards.length} cartas.`);
}

function getCardRarity(card) {
    if (CARDS.legendary.includes(card)) return 'legendary';
    if (CARDS.epic.includes(card)) return 'epic';
    if (CARDS.uncommon.includes(card)) return 'uncommon';
    return 'common';
}

// Menu event listeners
document.querySelectorAll('.staff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.staff-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        gameState.selectedStaff = btn.dataset.staff;
        document.getElementById('selectedStaffName').textContent = classData[btn.dataset.staff].name;
        updateDisplay('class', btn.dataset.staff);
        checkSelections();
    });
});

document.querySelectorAll('.hat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.hat-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        gameState.selectedHat = btn.dataset.hat;
        document.getElementById('selectedHatName').textContent = traitData[btn.dataset.hat].name;
        updateDisplay('trait', btn.dataset.hat);
        checkSelections();
    });
});

document.getElementById('startGame').addEventListener('click', () => {
    if (gameState.selectedStaff && gameState.selectedHat) {
        // Initialize audio context on user interaction
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        document.getElementById('gameMenu').classList.add('hidden');
        initGame();
        
        // Start first wave
        gameState.waveStartTime = gameState.gameTime;
        gameState.lastEnemySpawn = gameState.gameTime;
        
        gameState.running = true;
        gameLoop();
    }
});

document.getElementById('nightmareChallenge').addEventListener('click', () => {
    if (gameState.selectedStaff && gameState.selectedHat) {
        // Initialize audio context on user interaction
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        document.getElementById('gameMenu').classList.add('hidden');
        initNightmareMode();
        
        // Start nightmare wave
        gameState.waveStartTime = gameState.gameTime;
        gameState.lastEnemySpawn = gameState.gameTime;
        
        gameState.running = true;
        gameLoop();
    }
});

document.getElementById('restartGame').addEventListener('click', () => {
    document.getElementById('gameOver').classList.add('hidden');
    document.getElementById('gameMenu').classList.remove('hidden');
    
    // Reset ranking UI também
    resetRankingUI();
    
    // Reset game state completely
    gameState.running = false;
    gameState.paused = false;
    gameState.gameTime = 0; // Reset game time
    gameState.lastTime = 0; // Reset last time
    gameState.ownedCards = []; // Clear owned cards
    gameState.score = 0;
    gameState.souls = 0;
    gameState.enemiesKilled = 0;
    gameState.scoreSubmitted = false; // Reset ranking flag
    gameState.environmentEffects = {
        lightning: { active: false, level: 0, lastTrigger: 0 },
        meteor: { active: false, level: 0, lastTrigger: 0 },
        thorns: { active: false, level: 0, lastTrigger: 0 },
        poison: { active: false, level: 0, lastTrigger: 0 },
        fire: { active: false, level: 0, lastTrigger: 0 }
    };
    
    // Reset wave system completely
    gameState.wave = 1;
    gameState.waveStartTime = 0;
    gameState.lastEnemySpawn = 0;
    gameState.enemySpawnRate = 800; // Reset to initial spawn rate
    gameState.maxEnemiesThisWave = 1; // Reset to initial max enemies
    gameState.enemiesSpawnedThisWave = 0;
    gameState.enemiesInWave = 0;
    gameState.waveDuration = 60000;
    
    // Reset player stats to initial values
    gameState.playerStats = {
        health: 120,
        maxHealth: 120,
        damage: 40,
        speed: CONFIG.PLAYER_SPEED,
        fireRate: 1000, // Reset to initial fire rate
        multishot: 1,
        lifesteal: 0,
        damageReduction: 0,
        explosive: false,
        piercing: false,
        ricochet: false,
        ricochetLevel: 0,
        explosiveDeath: false,
        explosiveDeathLevel: 0,
        magnetism: false,
        magnetismLevel: 0,
        willOWisp: null,
        berserker: false,
        berserkerLevel: 0,
        timeFreeze: false,
        timeFreezeLevel: 0,
        timeFreezeChance: 0,
        vampiricShots: false,
        vampiricLevel: 0
    };
    
    // Clear all game entities
    bullets = [];
    enemies = [];
    drops = [];
    damageIndicators = [];
    particles = [];
    if (enemies.bullets) enemies.bullets = [];
    
    // Clear environment objects
    environmentObjects = {
        lightning: [],
        meteors: [],
        thorns: [],
        poisonClouds: [],
        firePillars: []
    };
    
    // Reset terrain
    initializeTerrain();
    
    console.log('Jogo resetado completamente');
});

// Ranking System Functions
async function submitScore(playerName, score, wave) {
    try {
        if (!window.firebaseDB) {
            throw new Error('Firebase não carregado');
        }

        const { db, collection, addDoc } = window.firebaseDB;
        
        const scoreData = {
            playerName: playerName.trim().substring(0, 20), // Limit name length
            score: score,
            wave: wave,
            timestamp: new Date(),
            staff: gameState.selectedStaff,
            hat: gameState.selectedHat
        };

        await addDoc(collection(db, 'rankings'), scoreData);
        
        console.log('Pontuação enviada com sucesso!');
        return true;
    } catch (error) {
        console.error('Erro ao enviar pontuação:', error);
        return false;
    }
}

async function loadRanking() {
    try {
        if (!window.firebaseDB) {
            throw new Error('Firebase não carregado');
        }

        const { db, collection, getDocs, query, orderBy, limit } = window.firebaseDB;
        
        const rankingQuery = query(
            collection(db, 'rankings'),
            orderBy('score', 'desc'),
            limit(50)
        );
        
        const querySnapshot = await getDocs(rankingQuery);
        const rankings = [];
        
        querySnapshot.forEach((doc) => {
            rankings.push(doc.data());
        });
        
        return rankings;
    } catch (error) {
        console.error('Erro ao carregar ranking:', error);
        return [];
    }
}

async function loadAccessCount() {
    try {
        if (!window.firebaseDB) {
            throw new Error('Firebase não carregado');
        }

        const { db, doc, getDoc } = window.firebaseDB;
        
        const statsRef = doc(db, 'stats', 'gameAccess');
        const docSnap = await getDoc(statsRef);
        
        if (docSnap.exists()) {
            return docSnap.data().totalAccess || 0;
        } else {
            return 0;
        }
    } catch (error) {
        console.error('Erro ao carregar contagem de acessos:', error);
        return 0;
    }
}

function displayRanking(rankings, accessCount) {
    const rankingList = document.getElementById('rankingList');
    const totalAccessSpan = document.getElementById('totalAccess');
    
    totalAccessSpan.textContent = accessCount.toLocaleString();
    
    if (rankings.length === 0) {
        rankingList.innerHTML = '<p>Nenhuma pontuação encontrada.</p>';
        return;
    }
    
    let html = '';
    rankings.forEach((entry, index) => {
        const position = index + 1;
        const date = entry.timestamp?.toDate ? entry.timestamp.toDate().toLocaleDateString('pt-BR') : 'Data desconhecida';
        const staffIcon = classData[entry.staff]?.icon || '🪄';
        const hatIcon = traitData[entry.hat]?.icon || '🎩';
        
        let itemClass = 'ranking-item';
        if (position === 1) itemClass += ' top1';
        else if (position <= 3) itemClass += ' top3';
        
        html += `
            <div class="${itemClass}">
                <span class="ranking-position">#${position}</span>
                <span class="ranking-name">${entry.playerName} ${staffIcon}${hatIcon}</span>
                <span class="ranking-score">${entry.score.toLocaleString()}</span>
                <span class="ranking-wave">Onda ${entry.wave}</span>
            </div>
        `;
    });
    
    rankingList.innerHTML = html;
}

// Event Listeners for Ranking
document.getElementById('submitScore').addEventListener('click', async () => {
    const playerName = document.getElementById('playerName').value.trim();
    const submitBtn = document.getElementById('submitScore');
    
    // Verificar se já foi enviado
    if (gameState.scoreSubmitted) {
        alert('Pontuação já foi enviada para esta partida!');
        return;
    }
    
    // Validações
    if (!playerName) {
        alert('Por favor, digite seu nome!');
        return;
    }
    
    if (playerName.length > 20) {
        alert('Nome muito longo! Máximo 20 caracteres.');
        return;
    }
    
    // Desabilitar botão durante envio
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';
    
    try {
        const success = await submitScore(playerName, gameState.score, gameState.wave);
        
        if (success) {
            // Marcar como enviado
            gameState.scoreSubmitted = true;
            
            // Sucesso - mostrar confirmação
            document.getElementById('nameInput').classList.add('hidden');
            document.getElementById('scoreSubmitted').classList.remove('hidden');
            console.log('Pontuação enviada com sucesso!');
        } else {
            throw new Error('Falha no envio da pontuação');
        }
    } catch (error) {
        // Erro - resetar botão e mostrar mensagem
        console.error('Erro ao enviar pontuação:', error);
        alert('Erro ao enviar pontuação. Verifique sua conexão e tente novamente.');
        
        // Resetar estado do botão
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enviar Pontuação';
    }
});

document.getElementById('viewRanking').addEventListener('click', async () => {
    document.getElementById('rankingModal').classList.remove('hidden');
    document.getElementById('rankingList').innerHTML = '<p>Carregando ranking...</p>';
    
    const [rankings, accessCount] = await Promise.all([
        loadRanking(),
        loadAccessCount()
    ]);
    
    displayRanking(rankings, accessCount);
});

document.getElementById('closeRanking').addEventListener('click', () => {
    document.getElementById('rankingModal').classList.add('hidden');
});

document.getElementById('viewRankingMenu').addEventListener('click', async () => {
    document.getElementById('rankingModal').classList.remove('hidden');
    document.getElementById('rankingList').innerHTML = '<p>Carregando ranking...</p>';
    
    const [rankings, accessCount] = await Promise.all([
        loadRanking(),
        loadAccessCount()
    ]);
    
    displayRanking(rankings, accessCount);
});

// Initialize
console.log('Seraph\'s Arena carregado! Selecione suas opções e comece a jogar!');

// Game initialized and ready to play! 