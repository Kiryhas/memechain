const canvas = document.querySelector('#cubes');
const ctx = canvas.getContext('2d');
const isMobile = matchMedia('(max-width: 768px)').matches;
const INIT_HEIGHT = 600;
const INIT_WIDTH = 800;
const MIN_DRAG_DISTANCE = 10;
const NULL_ID = -1;
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
        const gameView = new GameView(ctx, canvasWidth, canvasHeight);
        const controlManager = new ControlManager(cubeManager, gameView);
        const solver = new DFSSolver(cubeManager);

        this.shuffler = shuffler;
        this.cubeManager = cubeManager;
        this.gameView = gameView;
        this.controlManager = controlManager;
        this.solver = solver;

        this.queryStringSeed();

        this.addControls();

        this.loop();
        controlManager.on('visibilitychange', document, _ => {
            this.loop(document.hidden);
        });
    }

    render = () => {
        const { score, seed, hasWon, hasLost, cubes } = this.cubeManager;
        const { selectedCubeId, draggingInProgress } = this.controlManager;
        const remainingCubes = cubes.filter(cube => !cube.disabled);

        this.loopID = requestAnimationFrame(this.render);

        this.gameView.clear();
        this.gameView.drawScoreBoard(score, seed, hasWon, hasLost);
        if (!hasWon) {
            const activeCube = cubes[selectedCubeId];
            const nonActiveCubes = remainingCubes.filter(cube => cube != activeCube);

            if (draggingInProgress) {
                this.gameView.drawCubes(nonActiveCubes);
                if (activeCube) this.gameView.drawCube(activeCube);
            } else {
                this.gameView.drawCubes(remainingCubes);
            }
            if (hasLost) {
                this.controlManager.stopListening();
            }
        }
        if (hasWon) this.gameView.drawWinScreen(remainingCubes);
    }

    loop(disable = false) {
        if (this.loopID) cancelAnimationFrame(this.loopID);
        if (!disable) this.loopID = requestAnimationFrame(this.render);
    }

    addControls() {
        const handlersMap = {
            '.controls-back': () => {
                this.gameView.reset();
                this.controlManager.reset();
                this.cubeManager.historyPop();
            },
            '.controls-reset': () => {
                this.gameView.reset();
                this.controlManager.reset();
                this.cubeManager.startNewGame();
            },
            '.controls-seed': () => {
                this.controlManager.reset();
                this.manualSeed();
            },
            '.controls-share': () => {
                this.share();
            },
            '.controls-solve': () => {
                this.controlManager.stopListening();
                this.solve();
                this.controlManager.startListening();
            }
        }

        for (let selector in handlersMap) {
            const element = document.querySelector(selector);
            const handler = handlersMap[selector];
            this.controlManager.on('click', element, handler);
        }
    }

    solve() {
        this.cubeManager.restart();
        this.solver.solve(53);
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
        const seed = new URL(location.href).searchParams.get('s') ?? void 0;
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
}

class CubeManager {
    #cubes;
    #cubesById;

    constructor(shuffler) {
        this.shuffler = shuffler;

        this.history = [];
        this.hasWon = false;
        this.hasLost = false;
        this.score = 0;

        this.startNewGame();
    }

    set cubes(cubes) {
        this.#cubes = cubes;
        this.#cubesById = this.#cubes.reduce((acc, cube) => {
            acc[cube.id] = cube;
            return acc;
        }, {});
    }

    get cubes() {
        return this.#cubes;
    }

    get cubesById() {
        return this.#cubesById;
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

    restart() {
        this.resetGame();
        this.startNewGame(this.seed);
    }

    closestCubeInPositionId(cubesInPosition) {
        const [cubeInPosition] = cubesInPosition
            .filter(cube => !cube.disabled)
            .sort(({ coordinates: [xA, yA, zA] }, { coordinates: [xB, yB, zB] }) => xB + yB + zB - xA - yA - zA);

        if (!cubeInPosition) return NULL_ID;

        return cubeInPosition.id;
    }

    combineCubes(toAddId, toBeAddedToId) {
        if (this.canCombine(toAddId, toBeAddedToId)) {
            const [toAdd, toBeAddedTo] = [this.cubesById[toAddId], this.cubesById[toBeAddedToId]];
            Cube.addCubes(toAdd, toBeAddedTo);
            this.historyPush(toAddId, toBeAddedToId);
            this.addScore(toAdd.value);
            return true;
        }
        return false;
    }

    updateGameStatus() {
        if (this.winCondition()) {
            this.hasWon = true;
            // this.stopListeningToCubeEvents();
        } else if (!this.hasLost && !this.areMovesAvailable()) {
            // alert(`Game Over \nScore: ${this.score}`);
            this.hasLost = true;
        }
    }

    winCondition() {
        return this.cubes.filter(cube => !cube.disabled && cube.value == 128).length == 4;
    }

    addScore(n) {
        this.score += n * 10;
    }

    subtractScore(n) {
        this.score -= n * 10;
    }

    historyPush(toAddId, toBeAddedToId) {
        this.history.push([toAddId, toBeAddedToId]);
        this.updateGameStatus();
    }

    historyPop() {
        if (this.history.length && !this.hasWon) {
            const [toAdd, addedTo] = this.history.pop();
            Cube.revertAddition(this.cubesById[toAdd], this.cubesById[addedTo]);
            this.subtractScore(this.cubes[toAdd].value);
            if (this.hasLost) this.hasLost = false;
        }
        this.updateGameStatus();
    }

    canCombine(toAddId, toBeAddedToId) {
        if (toAddId == NULL_ID || toBeAddedToId == NULL_ID || toAddId == toBeAddedToId) return false;
        if (this.hasCubeAbove(toBeAddedToId, toAddId)) return false;
        if (this.hasCubeAbove(toAddId)) return false;

        const [toAdd, toBeAddedTo] = [this.cubesById[toAddId], this.cubesById[toBeAddedToId]];
        return Cube.canBeCombined(toAdd, toBeAddedTo);
    }

    hasCubeAbove(id, ignoreId) {
        const cube = this.cubesById[id];
        if (!cube) return false;
        const { coordinates: [x, y, z] } = cube;

        const cubeAbove = this.cubes.find(Cube.positionMatcher(x, y + 1, z));
        if (!cubeAbove) return false;

        const cubeAboveId = cubeAbove.id;
        return cubeAboveId != ignoreId && !cubeAbove.disabled;
    }

    isCubeCovered(id) {
        const cube = this.cubesById[id];
        if (!cube) return true;
        const { coordinates } = cube;
        const [x, y, z] = coordinates;

        const cubeRight = this.cubes.find(Cube.positionMatcher(x + 1, y + 1, z));
        const cubeLeft = this.cubes.find(Cube.positionMatcher(x, y + 1, z + 1));
        const cubeInFront = this.cubes.find(Cube.positionMatcher(x + 1, y + 1, z + 1));

        return (cubeInFront && !cubeInFront.disabled) || (cubeRight && cubeLeft && !cubeRight.disabled && !cubeLeft.disabled);
    }

    getFreeCubes() {
        const freeCubes = this.cubes.filter((cube) => {
            return !cube.disabled && !this.hasCubeAbove(cube.id) && !this.isCubeCovered(cube.id)
        });

        return freeCubes;
    }

    getAvailableMoves(breakOnFirstEntry = true) {
        const freeCubes = this.getFreeCubes();

        const availableMoves = [];

        for (let cube of freeCubes) {
            const id = cube.id;
            const { coordinates: [x, y, z] } = cube;

            const cubeBelow = this.cubes.find(Cube.positionMatcher(x, y - 1, z));
            const cubeBelowId = cubeBelow ? cubeBelow.id : NULL_ID;

            let checkAgainst = freeCubes.map(cube => cube.id);
            if (cubeBelowId != NULL_ID) checkAgainst.push(cubeBelowId);

            for (let checkAgainstId of checkAgainst) {
                if (this.canCombine(id, checkAgainstId)) {
                    availableMoves.push([id, checkAgainstId]);
                }
                if (availableMoves.length && breakOnFirstEntry) return availableMoves;
            };
        }

        return availableMoves;
    }

    areMovesAvailable() {
        const areMovesAvailable = this.getAvailableMoves().length > 0;
        return areMovesAvailable;
    }

    export() {
        const shortState = this.cubes
            .filter(cube => !cube.disabled)
            .map(Cube.export)
            .reduce((acc, cube) => {
                acc.push(`${cube.id};${cube.value}`);
                return acc;
            }, []).join(',');

        return {
            seed: this.seed,
            history: this.history.map((entry) => Array.from(entry)),
            hasWon: this.hasWon,
            hasLost: this.hasLost,
            shortState,
        };
    }

    import(game) {
        const { seed, history } = game;
        this.startNewGame(seed);

        for (let [toAddId, toBeAddedToId] of history) {
            this.combineCubes(toAddId, toBeAddedToId);
        }
    }
}

class Cube {
    constructor(id = NULL_ID, x = 0, y = 0, z = 0, value = 2, color = 0, disabled = false) {
        this.id = id;
        this.coordinates = [x, y, z];
        this.value = value;
        this.color = color;
        this.disabled = disabled;
        this.stroke = false;

        this.xComplement = 0;
        this.yComplement = 0;
        this.setComplement()

        this.x = 0;
        this.y = 0;
        this.paths = null;
        this.resetPosition();

        this.rotation = 0;
        this.opacity = 1;
    }

    resetPosition() {
        const [x, y, z] = this.coordinates;
        this.setComplement();
        this.updatePosition(Cube.calculateRenderX(x, z), Cube.calculateRenderY(x, y, z));
    }

    enableStroke() {
        this.stroke = true;
    }

    disableStroke() {
        this.stroke = false;
    }

    enableDragging() {
        this.opacity = 0.5;
    }

    disableDragging() {
        this.opacity = 1;
    }

    setComplement(x = 0, y = 0) {
        this.xComplement = x, this.yComplement = y;
    }

    updatePosition(x, y) {
        this.x = x - this.xComplement;
        this.y = y - this.yComplement;
        this.paths = Cube.cubePaths(x - this.xComplement, y - this.yComplement);
    }

    static import(cube) {
        const { id, coordinates, value, color, disabled } = cube;
        return new Cube(id, ...coordinates, value, color, disabled);
    }

    static export(cube) {
        const { id, coordinates, value, color, disabled } = cube;
        return { id, coordinates, value, color, disabled };
    }

    static positionMatcher(x, y, z) {
        return ({ coordinates: [cubeX, cubeY, cubeZ] }) => cubeX == x && cubeY == y && cubeZ == z;
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
    constructor(seed, legacyMode = false, numberOfColors = 4, values = [32, 32, 16, 8, 8, 8, 4, 4, 4, 4, 2, 2, 2, 2]) {
        this.numberOfColors = numberOfColors;
        this.values = values;
        this.legacyMode = legacyMode;
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
            this.values.map(value => new Cube(NULL_ID, 0, 0, 0, value, group))
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
        let id = 0;

        if (this.legacyMode) {
            for (let y = 0; y < 6; y++) {
                for (let x = 0; x < 6 - y; x++) {
                    for (let z = 0; z < 6 - x - y; z++) {
                        this.initCube(id, z, 6 - x, y - 1 - z);
                        id++;
                    }
                }
            }
            return;
        }

        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6 - y; x++) {
                for (let z = 0; z < 6 - x - y; z++) {
                    this.initCube(id, x, y, z);
                    id++;
                }
            }
        }
    }

    initCube(id, x, y, z) {
        this.cubes[id].coordinates = [x, y, z];
        this.cubes[id].id = id;
        this.cubes[id].resetPosition();
    }

    generateNewGame() {
        this.generateCubes();
        this.shuffleCubes();
        this.initPositions();

        return [this.cubes, this.seed];
    }
}

class ControlManager {
    #selectedCubeId = -1;
    #hoverOverCubeId = -1;

    constructor(cubeManager, gameView) {
        this.cubeManager = cubeManager;
        this.gameView = gameView;
        this.reset();
    }

    set selectedCubeId(id = NULL_ID) {
        const previousCube = this.selectedCube;
        if (previousCube) {
            previousCube.disableDragging();
            previousCube.disableStroke();
            previousCube.resetPosition();
        }

        this.#selectedCubeId = id;
        if (this.selectedCube) this.selectedCube.enableDragging();
        this.selectedCubeChanged = true;
    }

    get selectedCubeId() {
        return this.#selectedCubeId;
    }

    get selectedCube() {
        return this.cubeManager.cubesById[this.selectedCubeId];
    }

    set hoverOverCubeId(id = NULL_ID) {
        if (this.hoverOverCube) this.hoverOverCube.disableStroke();
        this.#hoverOverCubeId = id;
    }

    get hoverOverCubeId() {
        return this.#hoverOverCubeId;
    }

    get hoverOverCube() {
        return this.cubeManager.cubesById[this.hoverOverCubeId];
    }

    get dragDistance() {
        if (!this.dragStart || !this.dragEnd) return 0;
        const [x1, y1] = this.dragStart, [x2, y2] = this.dragEnd;
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    startListening() {
        this.stopListening();

        this.on('touchstart mousedown', canvas, this.interactionStartHandler);
        this.on('touchend mouseup', document, this.interactionEndHandler);
        this.on('blur', window, this.interactionEndHandler);
    }

    stopListening() {
        this.off('touchstart mousedown', canvas, this.interactionStartHandler);
        this.off('touchmove mousemove', canvas, this.draggingHandler);
        this.off('touchend mouseup', document, this.interactionEndHandler);
        this.off('blur', window, this.interactionEndHandler);
    }

    reset() {
        this.selectedCubeId = -1;
        this.hoverOverCubeId = -1;

        this.selectedCubeChanged = false;
        this.draggingInProgress = false;
        this.interactionWithSelectedCube = false;

        this.dragStart = null;
        this.dragEnd = null;

        this.startListening();
    }

    cubeInPosition(x, y, ignoreId) {
        const cubes = this.cubeManager.cubes.filter(({ id }) => id != ignoreId);
        const cubesInPosition = this.gameView.cubesInPosition(cubes, x, y);
        const cubeInPositionId = this.cubeManager.closestCubeInPositionId(cubesInPosition);

        return cubeInPositionId;
    }

    interactionStartHandler = (event) => {
        if (event.target != canvas) return;

        this.selectedCubeChanged = false;
        this.on('touchmove mousemove', canvas, this.draggingHandler);
        const [x, y] = this.resolveEventPositionOnCanvas(event);
        let cubeId = this.cubeInPosition(x, y);
        if (this.cubeManager.hasCubeAbove(cubeId)) {
            cubeId = NULL_ID;
        }

        this.dragStart = [x, y];

        if (!this.selectedCube) {
            this.selectedCubeId = cubeId;
        }

        if (this.selectedCubeId == cubeId) {
            this.interactionWithSelectedCube = true;
        }
    }

    draggingHandler = (event) => {
        const position = this.resolveEventPositionOnCanvas(event);

        if (this.selectedCube) this.selectedCube.disableStroke();
        this.hoverOverCubeId = -1;

        if (!this.selectedCube || !this.interactionWithSelectedCube) return;

        if (this.draggingInProgress) {
            this.dragEnd = [...position];

            this.selectedCube.updatePosition(...position);

            this.hoverOverCubeId = this.cubeInPosition(...position, this.selectedCubeId);
            if (this.hoverOverCube && this.cubeManager.canCombine(this.selectedCubeId, this.hoverOverCubeId)) {
                this.hoverOverCube.enableStroke();
                this.selectedCube.enableStroke();
            }
        }
        if (!this.draggingInProgress) {
            const [x, y] = position;

            if (this.selectedCube) {
                this.selectedCube.setComplement(x - this.selectedCube.x, y - this.selectedCube.y);
            }
            this.draggingInProgress = true;
        }
    }

    interactionEndHandler = (event) => {
        const [x, y] = this.resolveEventPositionOnCanvas(event);

        const cubeId = this.cubeInPosition(x, y, this.selectedCubeId);

        const isDragging = this.draggingInProgress;
        const isDraggingClose = isDragging && this.dragDistance <= MIN_DRAG_DISTANCE;
        const isNotDraggingOrDraggingClose = (!isDragging || isDraggingClose) && !this.selectedCubeChanged;
        const isDraggingFar = isDragging && this.dragDistance > MIN_DRAG_DISTANCE;

        if (isDraggingFar || isNotDraggingOrDraggingClose) {
            this.cubeManager.combineCubes(this.selectedCubeId, cubeId);
            this.selectedCubeId = -1;
        }

        if (this.selectedCube) {
            this.selectedCube.disableStroke();
            this.selectedCube.resetPosition();
        }

        if (this.hoverOverCube) {
            this.hoverOverCube.disableStroke();
            this.hoverOverCubeId = -1;
        }

        this.interactionWithSelectedCube = false;
        this.draggingInProgress = false;
        this.interactionInProgress = false;
        this.off('touchmove mousemove', canvas, this.draggingHandler);
    }

    resolveEventPositionOnCanvas(event) {
        const isMobile = window.TouchEvent && event instanceof TouchEvent;
        const boundingRect = canvas.getBoundingClientRect();
        const { clientX, clientY } = event, { left, top } = boundingRect;
        let x, y;

        if (isMobile) {
            const [{ clientX: touchX, clientY: touchY }] = event.touches.length ? event.touches : event.changedTouches;
            x = touchX - left, y = touchY - top;
        } else if (event.button == 0) {
            x = clientX - left, y = clientY - top;
        }

        return [x, y];
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
}

class GameView {
    constructor(ctx, canvasWidth, canvasHeight) {
        this.ctx = ctx;
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.rotation = 0;
    }

    reset() {
        this.clear();
        this.rotation = 0;
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    cubesInPosition(cubes, x, y) {
        const cubesInPosition = [];
        for (let cube of cubes) {
            const [, , , backdrop] = cube.paths;
            if (this.ctx.isPointInPath(backdrop, x, y)) cubesInPosition.push(cube);
        }
        return cubesInPosition;
    }

    drawScoreBoard(score, seed, won, lost) {
        const x = this.canvasWidth / 2;
        const y = HEIGHT_CENTER - CUBE_HEIGHT * 6;
        const status = won ? 'won' : lost ? 'lost' : 'playing';

        this.ctx.font = `small-caps bolder 20px sans-serif`;
        this.ctx.fillStyle = '#fff';
        this.ctx.fillText(`score: ${score}`, x, y - 10);
        this.ctx.fillText(`seed: ${seed}`, x, y - 5 + CUBE_HEIGHT / 2);
        if (lost) this.ctx.fillStyle = '#ff0000';
        if (won) this.ctx.fillStyle = '#00ff00';
        this.ctx.fillText(`status: ${status}`, x, y + CUBE_HEIGHT);
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

    drawCube(cube) {
        const { x, y, paths, color, value, stroke, opacity = 1 } = cube;
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
        // this.ctx.fillText(cube.id, x + CUBE_WIDTH / 2, y + (CUBE_HEIGHT / 64 * 5) + 20);
    }

    drawRotatingCube(cube) {
        this.ctx.translate(cube.x + CUBE_WIDTH / 2, cube.y + CUBE_HEIGHT / 2);
        this.ctx.rotate(Math.PI / 180 * this.rotation);
        this.ctx.translate(-(cube.x + CUBE_WIDTH / 2), -(cube.y + CUBE_HEIGHT / 2));
        this.rotation += 0.05;
        if (this.rotation == 360) this.rotation = 0;
        this.drawCube(cube);
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
}

class RandomSolver {
    constructor(cubeManager) {
        this.cubeManager = cubeManager;
        this.reset();
    }

    get availableMoves() {
        return this.cubeManager.getAvailableMoves(false);
    }

    get randomMove() {
        const availableMoves = this.availableMoves;
        const randomIndex = Math.floor(Math.random() * availableMoves.length);
        return availableMoves[randomIndex];
    }

    reset() {
        this.tries = 0;
    }

    solve() {
        this.reset();
        while (!this.cubeManager.hasWon && this.tries < 10) {
            const randomMove = this.randomMove;
            this.cubeManager.combineCubes(...randomMove);

            if (this.cubeManager.hasLost) {
                this.cubeManager.restart();
                this.tries++;
            }
        }

        if (this.cubeManager.hasWon) {
            return console.log(`Solved in ${tries} tries`);
        }
        if (this.cubeManager.hasLost) {
            console.log(`Couldn't solve in ${tries} tries`);
        }
        console.log('Out of tries');
    }
}

class DFSSolver {
    constructor(cubeManager, maxIterations = 53) {
        this.cubeManager = cubeManager;
        this.maxIterations = maxIterations;
    }

    async solve(maxIterations = this.maxIterations) {
        const seenStates = new Set();
        const stack = [];
        let iterations = 0;

        const game = this.cubeManager.export();
        const availableMoves = this.cubeManager.getAvailableMoves(false);
        stack.push({
            game,
            availableMoves
        });

        while (stack.length > 0) {
            if (iterations++ >= maxIterations) {
                console.log(`Search terminated due to reaching max iterations(${iterations}).`);
                return false;
            }

            const result = await new Promise(resolve => {
                setTimeout(async () => {
                    resolve(await this.dfs(stack, seenStates))
                }, 0)
            });

            if (result) {
                console.log(`Solved in ${iterations} iterations.`);
                return result;
            }
        }

        console.log('No solution found.');
        return false;
    }

    async dfs(stack, seenStates) {
        const { game, availableMoves } = stack.pop();

        this.cubeManager.import(game);
        if (this.cubeManager.hasWon) return game;
        if (this.detectUnsolvableGame()) {
            this.skipped++;
            return false;
        }

        const evaluatedMoves = availableMoves.sort((a, b) => {
            return this.evaluateMove(a) - this.evaluateMove(b);
        });
        for (let move of evaluatedMoves) {
            this.cubeManager.combineCubes(...move);
            if (this.detectUnsolvableGame()) {
                this.skipped++;
                this.cubeManager.import(game);
                continue;
            }

            const newGame = this.cubeManager.export();
            const serializedGame = newGame.shortState;

            if (!seenStates.has(serializedGame)) {
                seenStates.add(serializedGame);
                stack.push({
                    game: newGame,
                    availableMoves: this.cubeManager.getAvailableMoves(false)
                });
            }

            this.cubeManager.import(game);
        }
    }

    detectUnsolvableGame() {
        // const freeCubes = this.cubeManager.getFreeCubes();
        const freeCubes = this.cubeManager.cubes.filter(cube => !cube.disabled);
        const cubesByColor = this.cubeManager.cubes.reduce((acc, cube) => {
            acc[cube.color] = acc[cube.color] || [];
            if (!cube.disabled) acc[cube.color].push(cube);
            return acc;
        }, {});
        let caseNumber = 0;

        const unsolvable = freeCubes.some(cube => {
            const { coordinates, value, color } = cube;
            const [x, y, z] = coordinates;

            // All checks below assume the same color as the cube we're checking
            const cubesBelow = this.cubeManager.cubes.filter(cube => {
                const [cubeX, cubeY, cubeZ] = cube.coordinates;
                return cubeX === x && cubeY < y && cubeZ === z && cube.color === color;
            });
            const otherCubes = cubesByColor[color].filter(c => {
                return !cubesBelow.includes(c) && c !== cube;
            });

            // Making sure there's no cube below with the same value
            const canCombineWithCubeBelow = cubesBelow.some(cube => {
                const [cubeX, cubeY, cubeZ] = cube.coordinates;
                return cube.value === value && cubeX === x && cubeY === y - 1 && cubeZ === z;
            });
            if (canCombineWithCubeBelow) return false;

            const case64 = cubesBelow.length > 0;
            const case32 = case64 && otherCubes.filter(({ value }) => value === 64).length;
            const case16 = case32 && otherCubes.filter(({ value }) => value === 32).length;
            const case8 = case16 && otherCubes.filter(({ value }) => value === 16).length;
            const case4 = case8 && otherCubes.filter(({ value }) => value === 8).length;
            const case2 = case4 && otherCubes.filter(({ value }) => value === 4).length;

            if (value === 64 && case64) {
                // console.log('Case 64 detected');
                caseNumber = 64;
                return 64;
            }
            if (value === 32 && case32) {
                // console.log('Case 32 detected');
                caseNumber = 32;
                return 32;
            }
            if (value === 16 && case16) {
                // console.log('Case 16 detected');
                caseNumber = 16;
                return 16;
            }
            if (value === 8 && case8) {
                // console.log('Case 8 detected');
                caseNumber = 8;
                return 8;
            }
            if (value === 4 && case4) {
                // console.log('Case 4 detected');
                caseNumber = 4;
                return 4;
            }
            if (value === 2 && case2) {
                // console.log('Case 2 detected');
                caseNumber = 2;
                return 2;
            }
        });

        return unsolvable && caseNumber;
    }

    evaluateMove([idA, idB]) {
        const hightC = 2;
        const valueC = 1;

        const cubeA = this.cubeManager.cubesById[idA];
        const cubeB = this.cubeManager.cubesById[idB];

        const heightDelta = cubeA.coordinates[1] - cubeB.coordinates[1];
        const valueAddition = 128 - cubeA.value + cubeB.value;

        const normalizedHeightDelta = heightDelta / 5;
        const normalizedValueAddition = valueAddition / 128;

        const score = hightC * normalizedHeightDelta + valueC * normalizedValueAddition;
        return score;
    }
}

game = new Game();

window.startSolve = async () => {
    let stop = false;
    window.stopSolve = () => stop = true;
    let solvedSeeds = [];

    const solve = async () => {
        while (!stop) {
            if (solvedSeeds.length >= 10) stop = true;
            game.cubeManager.startNewGame();
            console.log('Starting new game', game.cubeManager.seed);
            const result = await game.solver.solve(54);
            if (result) solvedSeeds.push(result);
        }
    }
    if (stop) console.log(solvedSeeds);
    solve();
}
