const canvas = document.querySelector('#cubes');
const ctx = canvas.getContext('2d');
const isMobile = matchMedia('(max-width: 768px)').matches;
const INIT_HEIGHT = 600;
const INIT_WIDTH = 800;
let scale = 1.5;
if (isMobile) {
    canvas.width = `${innerWidth - 10}`;
    canvas.height = `${innerHeight - 20}`;
    scale = 1 / (INIT_HEIGHT / innerHeight);
}
const { width: canvasWidth, height: canvasHeight } = canvas;
const [CUBE_WIDTH, CUBE_HEIGHT, FONT_SIZE] = scaleCubeSizes(scale);
const WIDTH_CENTER = (canvasWidth / 2 - CUBE_WIDTH / 2);
const HEIGHT_CENTER = canvasHeight / 2;
ctx.strokeStyle = '#fff';
ctx.setLineDash([15, 10]);
ctx.lineCap = 'round';
ctx.textAlign = 'center';
const CUBE_COLORS = [
    ['#CF18C5', '#E513C8', '#CD129C'], // purple
    ['#FC9100', '#FF7B00', '#E36B00'], // orange
    ['#004B98', '#07409E', '#132178'], // darker blue
    ['#008CC3', '#007DC8', '#0059B3'], // lighter blue
];
function scaleCubeSizes(scale = 1) {
    scale *= 10;
    const width = 5 * scale;
    const height = 3 * scale;
    const fontSize = `${1.1 * scale}px`;

    return [width, height, fontSize];
}

class Game {
    constructor() {
        const shuffler = new BasicShuffler();
        const cubeManager = new CubeManager(shuffler);
        const controlManager = new ControlManager(cubeManager);
        const gameView = new GameView(ctx, canvasWidth, canvasHeight);

        this.shuffler = shuffler;
        this.cubeManager = cubeManager;
        this.gameView = gameView;
        this.controlManager = controlManager;

        this.queryStringSeed();

        this.addControls();

        this.loop();
        controlManager.on('visibilitychange', document, _ => {
            this.loop(document.hidden);
        });
    }

    render() {
        const { score, seed, hasWon, hasLost, cubes } = this.cubeManager;
        const { activeCubeIndex, draggingInProgress } = this.controlManager;
        const remainingCubes = cubes.filter(cube => !cube.disabled);

        this.loopID = requestAnimationFrame(this.renderHandler);

        this.gameView.clear();
        this.gameView.drawScoreBoard(score, seed);
        if (!hasWon && !hasLost) {
            const activeCube = cubes[activeCubeIndex];
            const nonActiveCubes = remainingCubes.filter(cube => cube != activeCube);

            if (draggingInProgress) {
                this.gameView.drawCubes(nonActiveCubes);
                if (activeCube) this.gameView.drawCube(activeCube);
            } else {
                this.gameView.drawCubes(remainingCubes);
            }
        }
        if (hasWon) this.gameView.drawWinScreen(remainingCubes);
        // if (hasLost) this.gameView.drawLoseScreen(cubes);
    }

    loop(disable = false) {
        if (this.loopID) cancelAnimationFrame(this.loopID);
        if (!disable) this.loopID = requestAnimationFrame(this.renderHandler);
    }

    addControls() {
        ['back', 'reset', 'seed', 'share'].map(name => {
            const element = document.querySelector(`.controls-${name}`);
            const handler = this[`${name}Handler`];
            this.controlManager.on('click', element, handler);
        });
    }

    share() {
        if (navigator.share) {
            navigator.share({
                title: 'Play a game of cubes!',
                text: 'Try to disassemble a pyramid of cubes in this game that is full of fun!',
                url: location.origin + location.pathname + (this.cubeManager.hasWon ? `?s=${this.cubeManager.seed}` : '')
            });
        }
    }

    queryStringSeed() {
        let seed = new URL(location.href).searchParams.get('s') ?? void 0;
        if (!seed) return;

        if (this.shuffler.isValidSeed(seed)) {
            history.replaceState({}, '', location.pathname);
            return this.cubeManager.startNewGame(seed);
        }
        alert('Seed must be a 7-digit number');
    }

    manualSeed() {
        const seed = prompt('Enter seed');
        if (seed && this.shuffler.isValidSeed(seed)) {
            return this.cubeManager.startNewGame(seed);
        }
        return alert('Seed must be a 7-digit number');
    }

    backHandler = () => {
        this.cubeManager.popHistory();
    }

    resetHandler = () => {
        this.cubeManager.startNewGame();
    }

    seedHandler = () => {
        this.manualSeed();
    }

    shareHandler = () => {
        this.share();
    }

    renderHandler = () => {
        this.render();
    }
}

class CubeManager {
    constructor(shuffler) {
        this.shuffler = shuffler;

        this.history = [];
        this.hasWon = false;
        this.hasLost = false;
        this.score = 0;

        this.startNewGame();
    }

    resetGame() {
        this.hasWon = false;
        this.hasLost = false;
        this.history = [];
        this.score = 0;
    }

    startNewGame(seed) {
        this.resetGame();
        this.shuffler.setSeed(seed);
        [this.cubes, this.seed] = this.shuffler.generateNewGame(seed);
    }

    cubeInPosition(x, y, ignoreIndex) {
        const [cubeInPosition] = this.cubes
            .filter((_, index) => index != ignoreIndex)
            .filter(cube => !cube.dragging && !cube.disabled)
            .filter(cube => Cube.isInPath(cube, x, y))
            .sort(({ coordinates: [xA, yA, zA] }, { coordinates: [xB, yB, zB] }) => xB + yB + zB - xA - yA - zA);
        return this.cubes.indexOf(cubeInPosition);
    }

    cubeIsCovered(cube) {
        const { coordinates: [x, y, z] } = cube;
        const cubeAbove = this.cubes.find(({ coordinates: [xAbove, yAbove, zAbove] }) => {
            return xAbove == x && yAbove == y + 1 && zAbove == z;
        });

        return cubeAbove && !cubeAbove.disabled && !cubeAbove.dragging;
    }

    popHistory() {
        if (this.history.length && !this.hasWon) {
            const [toAdd, addedTo] = this.history.pop();
            Cube.revertAddition(this.cubes[toAdd], this.cubes[addedTo]);
            this.subtractScore(this.cubes[toAdd].value);
            if (this.hasLost) this.hasLost = false;
        }
    }

    combineCubes(aIndex, bIndex) {
        if (this.canCombine(aIndex, bIndex)) {
            const [cubeA, cubeB] = [this.cubes[aIndex], this.cubes[bIndex]];
            Cube.addCubes(cubeA, cubeB);
            this.history.push([aIndex, bIndex]);
            this.addScore(cubeA.value);
            return true;
        }
        return false;
    }

    canCombine(aIndex, bIndex) {
        if (aIndex == -1 || bIndex == -1 || aIndex == bIndex) return false;

        const [cubeA, cubeB] = [this.cubes[aIndex], this.cubes[bIndex]];
        const { coordinates: [xA, yA, zA] } = cubeA;
        const { coordinates: [xB, yB, zB] } = cubeB;

        return Cube.canBeCombined(cubeA, cubeB);
    }

    updateGameStatus() {
        if (this.winCondition()) {
            this.hasWon = true;
            this.stopListeningToCubeEvents();
        } else if (!this.hasLost && !this.thereArePossibleCombinations()) {
            alert(`Game Over \nScore: ${this.score}`);
            this.hasLost = true;
        }
    }

    winCondition() {
        return this.cubes.filter(cube => !cube.disabled && cube.value == 128).length == 4;
    }

    coveringCubes(cube) {
        const { coordinates: [x, y, z] } = cube;
        if (x == 1) return [];
        const activeCubesAbove = this.cubes.filter(activeCube => !activeCube.disabled && activeCube.coordinates[0] == x - 1 && activeCube != cube);

        const cubeFilter = (y, z) => ({ coordinates: [, cubeY, cubeZ] }) => cubeY == y && cubeZ == z;
        const topCubeFilter = cubeFilter(y + 2, z + 1);
        const leftCubeFilter = cubeFilter(y + 1, z);
        const rightCubeFilter = cubeFilter(y + 1, z + 1);

        return [activeCubesAbove.find(topCubeFilter), activeCubesAbove.find(leftCubeFilter), activeCubesAbove.find(rightCubeFilter)];
    }

    thereArePossibleCombinations() {
        const freeCubes = this.cubes.filter(cube => !cube.disabled && !this.cubeIsCovered(cube)).filter(cube => {
            const coveringCubes = this.coveringCubes(cube);
            const { length } = coveringCubes.filter(Boolean);
            if (length) {
                if (length == 3) return false;

                const [top, left, right] = coveringCubes;

                if (top && (!left || !right)) return !this.cubeIsCovered(top) && Cube.canBeCombined(cube, top);
                if (!top && left && right) return ((!this.cubeIsCovered(left) && Cube.canBeCombined(cube, left))
                    || (!this.cubeIsCovered(right) && Cube.canBeCombined(cube, right)));
            }

            return true;
        });
        for (let i = 0; i < freeCubes.length; i++) {
            for (let j = i + 1; j < freeCubes.length; j++) {
                if (Cube.canBeCombined(freeCubes[i], freeCubes[j])) return true;
            }
        }

        return freeCubes.some(cube => {
            const { coordinates: [x, y, z] } = cube;
            if (x == 6) return false;
            const cubeBelow = this.cubes.find(cubeBelow => {
                const { coordinates: [xBelow, yBelow, zBelow] } = cubeBelow;
                return x + 1 == xBelow && y == yBelow && z == zBelow;
            });
            const cubeInFront = this.cubes.find(cube => {
                const { coordinates: [frontalX, frontalY, frontalZ] } = cube;
                return frontalX === x && frontalY === y + 1 && frontalZ === z;
            });

            return !cubeInFront && Cube.canBeCombined(cubeBelow, cube);
        });
    }

    addScore(n) {
        this.score += n * 10;
    }

    subtractScore(n) {
        this.score -= n * 10;
    }
}

class Cube {
    constructor(x = 0, y = 0, z = 0, value = 2, color = 0) {
        this.disabled = false;
        this.dragging = false;
        this.stroke = false;
        this.x = x;
        this.y = y;
        this.z = z;
        this.value = value;
        this.color = color;
        this.paths = null;
        this.xComplement = 0;
        this.yComplement = 0;
        this.rotation = 0;
        this.opacity = 1;
    }

    resetPosition() {
        const [x, y, z] = this.coordinates;
        this.setComplement();
        this.updatePosition(Cube.calculateRenderX(x, z), Cube.calculateRenderY(x, y, z));
    }

    setComplement(x = 0, y = 0) {
        this.xComplement = x, this.yComplement = y;
    }

    updatePosition(x, y) {
        this.x = x - this.xComplement;
        this.y = y - this.yComplement;
        this.paths = Cube.cubePaths(x - this.xComplement, y - this.yComplement);
    }

    static isInPath(cube, x, y) {
        const [, , , backdrop] = cube.paths;
        return ctx.isPointInPath(backdrop, x, y);
    }

    static addCubes(toAdd, toBeAddedTo) {
        toBeAddedTo.value *= 2;
        toAdd.disabled = true;
    }

    static revertAddition(toAdd, addedTo) {
        addedTo.value /= 2;
        toAdd.disabled = false;
    }

    static canBeCombined(toAdd, toBeAddedTo) {
        return (toAdd.color == toBeAddedTo.color && toAdd.value == toBeAddedTo.value);
    }

    static cubePaths(x, y) {
        const top = new Path2D();
        const left = new Path2D();
        const right = new Path2D();
        const backdrop = new Path2D();
        top.moveTo(x, y);
        top.lineTo(x + CUBE_WIDTH / 2, y + CUBE_HEIGHT / 2);
        top.lineTo(x + CUBE_WIDTH, y);
        top.lineTo(x + CUBE_WIDTH / 2, y - CUBE_HEIGHT / 2);
        top.lineTo(x, y);
        left.moveTo(x, y);
        left.lineTo(x, y + CUBE_HEIGHT);
        left.lineTo(x + CUBE_WIDTH / 2, y + CUBE_HEIGHT * 1.5);
        left.lineTo(x + CUBE_WIDTH / 2, y + CUBE_HEIGHT / 2);
        left.lineTo(x, y);
        right.moveTo(x + CUBE_WIDTH, y);
        right.lineTo(x + CUBE_WIDTH, y + CUBE_HEIGHT);
        right.lineTo(x + CUBE_WIDTH / 2, y + CUBE_HEIGHT * 1.5);
        right.lineTo(x + CUBE_WIDTH / 2, y + CUBE_HEIGHT / 2);

        backdrop.moveTo(x, y);
        backdrop.lineTo(x, y + CUBE_HEIGHT);
        backdrop.lineTo(x + CUBE_WIDTH / 2, y + CUBE_HEIGHT * 1.5);
        backdrop.lineTo(x + CUBE_WIDTH, y + CUBE_HEIGHT);
        backdrop.lineTo(x + CUBE_WIDTH, y);
        backdrop.lineTo(x + CUBE_WIDTH / 2, y - CUBE_HEIGHT / 2);
        backdrop.closePath();

        return [top, left, right, backdrop];
    }

    static calculateRenderX(x, z) {
        return (WIDTH_CENTER) + (x * CUBE_WIDTH / 2) - (z * CUBE_WIDTH / 2);
    }
    static calculateRenderY(x, y, z) {
        return (HEIGHT_CENTER + CUBE_HEIGHT / 2) - y * CUBE_HEIGHT + (z + x) * CUBE_HEIGHT / 2;
    }
}

class BasicShuffler {
    constructor(seed, numberOfColors = 4, values = [32, 32, 16, 8, 8, 8, 4, 4, 4, 4, 2, 2, 2, 2]) {
        this.numberOfColors = numberOfColors;
        this.values = values;
        this.setSeed(seed ? seed : this.getRandomSeed());
    }

    getRandomSeed() {
        return Number(String(Math.floor(Math.random() * 10e6)).padStart(7, '1'));
    }

    setSeed(seed) {
        if (this.isValidSeed(seed)) {
            return this.seed = Number(seed);
        }
        this.seed = this.getRandomSeed();
    }

    isValidSeed(seed) {
        return (((+seed).toString().length == 7) && /\d{7}/.test(seed));
    }

    generateCubes() {
        this.cubes = [...Array(this.numberOfColors).keys()].flatMap(group => (
            this.values.map(value => new Cube(0, 0, 0, value, group))
        ));
    }

    shuffleCubes() {
        const shuffledArray = [...this.cubes];
        let currentIndex = shuffledArray.length, seedOffset = 0, temporaryValue, randomIndex;
        const random = () => {
            const x = Math.sin(this.seed + seedOffset) * 10000;
            seedOffset++;
            return x - Math.floor(x);
        }
        while (currentIndex) {
            randomIndex = Math.floor(random() * currentIndex);
            currentIndex--;
            temporaryValue = shuffledArray[currentIndex];
            shuffledArray[currentIndex] = shuffledArray[randomIndex];
            shuffledArray[randomIndex] = temporaryValue;
        }
        this.cubes = shuffledArray;
    }

    initPositions() {
        let cubeIndex = 0;
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6 - y; x++) {
                for (let z = 0; z < 6 - x - y; z++) {
                    this.cubes[cubeIndex].coordinates = [x, y, z];
                    this.cubes[cubeIndex].resetPosition();
                    cubeIndex++;
                }
            }
        }
    }

    generateNewGame() {
        this.generateCubes();
        this.shuffleCubes();
        this.initPositions();

        return [this.cubes, this.seed];
    }
}

class ControlManager {
    constructor(cubeManager) {
        this.cubeManager = cubeManager;
        this.init();
    }

    init() {
        this.interactionStartHandler = this.interactionStart.bind(this);
        this.draggingHandler = this.dragging.bind(this);
        this.interactionEndHandler = this.interactionEnd.bind(this);

        this.changedActiveCube = false;
        this.draggingInProgress = false;

        this.dragStart = null;
        this.dragEnd = null;

        this.activeCubeIndex = -1;

        this.on('touchstart mousedown', canvas, this.interactionStartHandler);
        this.on('touchend mouseup', document, this.interactionEndHandler);
        this.on('focusout', window, this.interactionEndHandler);
    }

    get dragDistance() {
        if (!this.dragStart || !this.dragEnd) return 0;
        const [x1, y1] = this.dragStart, [x2, y2] = this.dragEnd;
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    setActiveCubeIndex(index) {
        this.resetActiveCubeIndex();
        const cube = this.cubeManager.cubes[index];
        if (cube) {
            cube.opacity = 0.5;
            this.activeCubeIndex = index;

            this.changedActiveCube = true;
        }
    }

    resetActiveCubeIndex() {
        if (this.activeCubeIndex != -1) {
            const cube = this.cubeManager.cubes[this.activeCubeIndex];
            cube.opacity = 1;
            this.activeCubeIndex = -1;
        }
    }

    interactionStart(e) {
        if (e.target != canvas) return;

        this.changedActiveCube = false;
        this.on('touchmove mousemove', canvas, this.draggingHandler);
        const [x, y] = this.resolveEventPositionOnCanvas(e);

        this.dragStart = [x, y];

        if (this.activeCubeIndex == -1) {
            this.setActiveCubeIndex(this.cubeManager.cubeInPosition(x, y));
        }
    }

    dragging(e) {
        const position = this.resolveEventPositionOnCanvas(e);
        const activeCube = this.cubeManager.cubes[this.activeCubeIndex];
        if (activeCube) activeCube.stroke = false;

        if (this.draggingInProgress) {
            this.dragEnd = [...position];

            activeCube.updatePosition(...position);

            const cubeBelow = this.cubeManager.cubeInPosition(...position, this.activeCubeIndex);
            if (this.cubeManager.canCombine(this.activeCubeIndex, cubeBelow)) {
                activeCube.stroke = true;
            }
        }
        if (!this.draggingInProgress) {
            const [x, y] = position;

            if (activeCube) {
                activeCube.setComplement(x - activeCube.x, y - activeCube.y);
            }

            this.draggingInProgress = true;
        }
    }

    interactionEnd(e) {
        const [x, y] = this.resolveEventPositionOnCanvas(e);
        const cubeIndex = this.cubeManager.cubeInPosition(x, y, this.activeCubeIndex);
        const activeCube = this.cubeManager.cubes[this.activeCubeIndex];

        if (this.draggingInProgress && this.dragDistance > 10) {
            this.cubeManager.combineCubes(this.activeCubeIndex, cubeIndex);
            this.resetActiveCubeIndex();
        }
        if (!this.draggingInProgress || (this.draggingInProgress && this.dragDistance <= 10)) {
            if (!this.changedActiveCube) {
                this.cubeManager.combineCubes(this.activeCubeIndex, cubeIndex);
                this.resetActiveCubeIndex();
            }
        }

        if (activeCube) {
            activeCube.stroke = false;
            activeCube.resetPosition();
        }
        this.draggingInProgress = false;
        this.interactionInProgress = false;
        this.off('touchmove mousemove', canvas, this.draggingHandler);
    }

    on(events, target, handler) {
        for (const event of events.split(' ')) {
            target.addEventListener(event, handler);
        }
    }

    off(events, target, handler) {
        for (const event of events.split(' ')) {
            target.removeEventListener(event, handler);
        }
    }

    resolveEventPositionOnCanvas(e) {
        const isMobile = window.TouchEvent && e instanceof TouchEvent;
        const boundingRect = canvas.getBoundingClientRect();
        const { clientX, clientY } = e, { left, top } = boundingRect;
        let x, y;

        if (isMobile) {
            const [{ clientX: touchX, clientY: touchY }] = e.touches.length ? e.touches : e.changedTouches;
            x = touchX - left, y = touchY - top;
        } else if (e.button == 0) {
            x = clientX - left, y = clientY - top;
        }

        return [x, y];
    }
}

class GameView {
    constructor(ctx, canvasWidth, canvasHeight) {
        this.ctx = ctx;
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.rotation = 0;
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    drawScoreBoard(score, seed) {
        const x = this.canvasWidth / 2;
        const y = HEIGHT_CENTER - CUBE_HEIGHT * 6;

        this.ctx.font = `small-caps bolder 20px sans-serif`;
        this.ctx.fillStyle = '#fff';
        this.ctx.fillText(`score: ${score}`, x, y - 10);
        this.ctx.fillText(`seed: ${seed}`, x, y - 5 + CUBE_HEIGHT / 2);
    }

    drawWinScreen(cubes) {
        for (const cube of cubes) {
            this.drawRotatingCube(cube);
        }
    }

    drawCubes(cubes) {
        for (const cube of cubes) {
            this.drawCube(cube);
        }
    }

    drawCube({ x, y, paths, color, value, stroke, opacity = 1 }) {
        const [top, left, right, backdrop] = paths;
        const [topColor, leftColor, rightColor] = CUBE_COLORS[color];

        if (opacity !== 1) {
            this.ctx.globalAlpha = opacity;
        }

        this.ctx.font = `bold ${FONT_SIZE} sans-serif`;
        this.ctx.fillStyle = topColor;
        this.ctx.fill(backdrop);
        this.ctx.fill(top);
        this.ctx.fillStyle = leftColor;
        this.ctx.fill(left);
        this.ctx.fillStyle = rightColor;
        this.ctx.fill(right);

        this.ctx.globalAlpha = 1;

        if (stroke) {
            this.ctx.stroke(top);
            this.ctx.stroke(left);
            this.ctx.stroke(right);
        }

        this.ctx.fillStyle = '#000';
        this.ctx.fillText(value, x + CUBE_WIDTH / 2, y + (CUBE_HEIGHT / 64 * 5));
    }

    drawRotatingCube(cube) {
        ctx.translate(cube.x + CUBE_WIDTH / 2, cube.y + CUBE_HEIGHT / 2);
        ctx.rotate(Math.PI / 180 * this.rotation);
        ctx.translate(-(cube.x + CUBE_WIDTH / 2), -(cube.y + CUBE_HEIGHT / 2));
        this.rotation += 0.05;
        if (this.rotation == 360) this.rotation = 0;
        this.drawCube(cube);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
}

const game = new Game();
