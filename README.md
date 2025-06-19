# Seraph's Arena - Jogo Roguelike Web 2D

Um jogo web 2D inspirado no **Seraph's Last Stand**, criado com HTML5, CSS e JavaScript puro.

## 🎮 Como Jogar

### Objetivo
Controle um mago poderoso em plataformas, sobreviva a ondas infinitas de inimigos voadores, colete cartas de melhorias e alcance a maior pontuação possível!

### Controles
- **A/D** ou **Setas Left/Right**: Mover horizontalmente
- **W/Espaço** ou **Seta Up**: Pular
- **Mouse**: Mirar
- **Clique do Mouse**: Atirar
- **Clique** nas cartas para selecioná-las

### Mecânicas do Jogo

#### 🏹 Staffs (Armas)
- **Wizard's Staff**: Projétil reto básico
- **Emerald Staff**: Projétil teleguiado (menos dano, mais precisão)
- **Trident**: Dispara 3 projéteis em cone
- **Boom Staff**: Projéteis explosivos

#### 🎩 Chapéus (Modificadores)
- **Wizard's Hat**: Sem efeito especial
- **Helmet**: +50% vida, -20% velocidade
- **Propeller Beanie**: +30% velocidade
- **Challenger's Hat**: +20% dano

#### 🃏 Sistema de Cartas

**Cartas Comuns:**
- **Crescimento**: +20% dano
- **Velocidade**: +1 velocidade
- **Vida**: +20 vida máxima
- **Cadência**: -20% tempo entre tiros

**Cartas Incomuns:**
- **Duplo Tiro**: Dispara projéteis duplos
- **Vida Vampira**: Recupera 1 HP por kill
- **Escudo**: +50% redução de dano
- **Rajada**: +50% cadência de tiro

**Cartas Épicas:**
- **Barreira**: Imune a dano por 5 segundos
- **Explosão**: Projéteis explodem ao impacto
- **Penetração**: Projéteis atravessam inimigos
- **Gigante**: +100% dano, +50% vida

### 🌊 Sistema de Ondas
- Cada onda tem mais inimigos que a anterior (progressão balanceada)
- A cada 3 ondas você pode escolher uma carta de melhoria
- Ondas múltiplas de 5 oferecem cartas épicas
- Inimigos ficam mais fortes conforme o jogo progride
- Spawn controlado para evitar sobrecarga

### 🏆 Pontuação
- Ganhe pontos matando inimigos
- Sobreviva o máximo de ondas possível
- Colete almas (baseadas na pontuação) para melhorias futuras

### ⚖️ Balanceamento
- **Velocidades ajustadas**: Movimento, projéteis e inimigos em ritmo mais estratégico
- **Mira manual**: Controle total sobre onde atirar com feedback visual
- **Taxa de tiro equilibrada**: Menos spam, mais precisão
- **Inimigos balanceados**: Vida, dano e frequência de tiro ajustados
- **Progressão suave**: Ondas crescem de forma controlada

### 🤖 IA dos Inimigos
- **Perseguição Inteligente**: Inimigos se movem diretamente em direção ao jogador
- **Evitam Colisões**: Sistema de evitamento para que não se sobreponham
- **Spawn do Topo**: Todos os inimigos aparecem da parte superior da tela
- **Ativação Gradual**: Inimigos têm um delay antes de começar a perseguir
- **Indicadores Visuais**: Olhos que seguem o jogador e setas direcionais
- **Estados Visuais**: Cor e comportamento mudam quando ativados
- **Combate Direto**: Inimigos também causam dano por contato (kamikaze)
- **Alcance de Tiro**: Atiram apenas quando estão dentro do alcance

## 🚀 Como Executar

1. Baixe todos os arquivos (`index.html`, `style.css`, `game.js`)
2. Abra o arquivo `index.html` em um navegador moderno
3. Selecione seu Staff e Chapéu
4. Clique em "Iniciar Jogo" e divirta-se!

## 🎯 Características

- **Gameplay de Plataforma**: Pule entre plataformas e explore o cenário
- **Física Realista**: Gravidade, pulo e colisões com plataformas
- **IA Inimiga Inteligente**: Inimigos perseguem o jogador diretamente, evitam colisões entre si
- **Mira Manual**: Controle preciso com mouse e crosshair visual
- **Pixel Art**: Visual retrô com efeitos modernos e brilhos
- **Partículas**: Efeitos visuais dinâmicos e explosões
- **Sistema de Cartas**: Centenas de combinações possíveis
- **Progressão**: Sistema de ondas infinitas
- **Audio Procedural**: Efeitos sonoros gerados dinamicamente

## 🛠️ Tecnologias Utilizadas

- **HTML5 Canvas**: Renderização 2D
- **CSS3**: Estilização moderna com gradientes e animações
- **JavaScript ES6+**: Lógica do jogo com classes e módulos
- **Google Fonts**: Tipografia Orbitron para visual futurista

## 🎨 Créditos

Inspirado no jogo **Seraph's Last Stand** de André Young/Sad Socket. Este é um projeto educacional/recreativo criado para demonstrar desenvolvimento de jogos web.

---

**Divirta-se jogando Seraph's Arena! 🎮** 