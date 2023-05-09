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

class Game {
    constructor() {
        this.cubeManager = new CubeManager();
        this.renderHandler = this.render.bind(this);

        this.loop();

        on('visibilitychange', document, _ => {
            this.loop(document.hidden);
        });
    }

    render() {
        this.loopID = requestAnimationFrame(this.renderHandler);
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        this.cubeManager.draw();
    }

    loop(disable = false) {
        if (this.loopID) cancelAnimationFrame(this.loopID);
        if (!disable) this.loopID = requestAnimationFrame(this.renderHandler);
    }
}

class CubeManager {
    constructor() {
        this.history = [];

        this.movementStartHandler = this.movementStart.bind(this);
        this.movementEndHandler = this.movementEnd.bind(this);
        this.draggingCubeHandler = this.draggingCube.bind(this);
        this.newFieldInitHandler = this.newFieldInit.bind(this);
        this.newFieldInitWithSeedHandler = this.newFieldInitWithSeed.bind(this);
        this.popHistoryHandler = this.popHistory.bind(this);
        this.shareHandler = this.share.bind(this);

        this.draggedCube = null;
        this.hoveringOverCube = null;
        this.scoreBoard = null;
        this.hasWon = false;
        this.hasLost = false;

        this.newFieldInit(this.resolveSeedOnInit());
        this.listenToCubeEvents();
        this.addControls();
    }

    resolveSeedOnInit() {
        let seed = new URL(location.href).searchParams.get('s') ?? void 0;
        if (seed) {
            history.replaceState({}, '', location.pathname);
            if (!isValidSeed(seed)) seed = void 0;
        }

        return seed;
    }

    share() {
        if (navigator.share) {
            navigator.share({
                title: 'Play a game of cubes!',
                text: 'Try to disassemble a pyramid of cubes in this game that is full of fun!',
                url: location.origin + location.pathname + (this.hasWon ? `?s=${this.scoreBoard.seed}` : '')
            });
        }
    }


    addControls() {
        const [back, seed, reset, share] = ['back', 'seed', 'reset', 'share'].map(btn => document.querySelector(`.controls-${btn}`));

        on('click', back, this.popHistoryHandler);
        on('click', seed, this.newFieldInitWithSeedHandler);
        on('click', reset, _ => this.newFieldInitHandler());
        on('click', share, this.shareHandler);
    }

    newFieldInitWithSeed() {
        const seed = prompt('Enter seed');
        if (seed) {
            if (isValidSeed(seed)) this.newFieldInit(+seed);
            else return alert('Seed must be a 7-digit number');
        }
    }

    newFieldInit(seed) {
        if (this.hasWon) {
            this.hasWon = false;
            this.listenToCubeEvents();
        }
        if (this.hasLost) this.hasLost = false;
        this.history = [];
        [this.cubes, this.seed] = this.generateCubes(seed);
        this.initPositions();
        this.scoreBoard = new ScoreBoard(this.seed);
    }

    generateCubes(seed) {
        const cubes = [0, 1, 2, 3].flatMap(group => (
            [32, 32, 16, 8, 8, 8, 4, 4, 4, 4, 2, 2, 2, 2].map(value => new Cube(0, 0, 0, value, group))
        ));
        return shuffle(cubes, seed);
    }

    initPositions() {
        let startX = WIDTH_CENTER + CUBE_WIDTH / 2;
        let startY = HEIGHT_CENTER;
        let cubeIndex = 0;
        for (let x = 6; x > 0; x--) {
            for (let y = 1; y <= x; y++) {
                let currentRowX = startX - y * CUBE_WIDTH / 2;
                const currentRowY = (startY + y * CUBE_HEIGHT / 2);
                for (let z = 0; z < y; z++) {
                    this.cubes[cubeIndex].updatePosition(currentRowX, currentRowY, 6 - x + y);
                    this.cubes[cubeIndex].cubeCoordinates = [x, y, z];

                    currentRowX += CUBE_WIDTH;
                    cubeIndex++;
                }
            }
            startY = startY - CUBE_HEIGHT;
        }
    }

    cubeInPosition(x, y) {
        const [cubeInPosition] = this.cubes
            .filter(cube => !cube.dragging && !cube.disabled && Cube.isInPath(cube, x, y))
            .sort((a, b) => b.z - a.z);
        return this.cubes.indexOf(cubeInPosition);
    }

    cubeIsCovered(cube) {
        const cubeIndex = this.cubes.indexOf(cube);
        const { cubeCoordinates: [x, y, z] } = cube;
        const indexOfCubeAbove = this.cubes.findIndex(({ cubeCoordinates: [xAbove, yAbove, zAbove] }) => {
            return xAbove == x - 1 && yAbove == y && zAbove == z;
        });

        if (indexOfCubeAbove > cubeIndex && !this.cubes[indexOfCubeAbove]?.disabled && !this.cubes[indexOfCubeAbove]?.dragging) {
            return true;
        }

        return false;
    }

    popHistory() {
        if (this.history.length && !this.hasWon) {
            const [toAdd, addedTo] = this.history.pop();
            Cube.revertAddition(this.cubes[toAdd], this.cubes[addedTo]);
            this.scoreBoard.subtractScore(this.cubes[toAdd].value);
            if (this.hasLost) this.hasLost = false;
        }
    }

    dragCube(cubeIndex) {
        this.draggedCube = this.cubes[cubeIndex];
        this.draggedCube.dragging = true;
        this.draggedCube.savePosition();
    }

    releaseCube() {
        if (this.draggedCube) {
            this.draggedCube.dragging = false;
            this.draggedCube.setComplement();
            this.draggedCube.restorePosition();
            this.draggedCube.opacity = 1;
            this.draggedCube.stroke = false;
            delete this.draggedCube;
        }
    }
    movementStart(e) {
        if (e.target != canvas || this.draggedCube) return;
        const [x, y] = resolveEventPositionOnCanvas(e);
        const cubeInPositionIndex = this.cubeInPosition(x, y);

        if (cubeInPositionIndex >= 0 && !this.cubeIsCovered(this.cubes[cubeInPositionIndex])) {
            this.dragCube(cubeInPositionIndex);
            const { x: startX, y: startY } = this.draggedCube;
            this.draggedCube.setComplement(x - startX, y - startY);
            on('touchmove mousemove', canvas, this.draggingCubeHandler);
        }
    }

    movementEnd(e) {
        const [x, y] = resolveEventPositionOnCanvas(e);
        if (this.draggedCube) {
            const cubeInPositionIndex = this.cubeInPosition(x, y);
            if (cubeInPositionIndex >= 0 && !this.cubeIsCovered(this.cubes[cubeInPositionIndex]) && Cube.canBeCombined(this.draggedCube, this.cubes[cubeInPositionIndex])) {
                Cube.addCubes(this.draggedCube, this.cubes[cubeInPositionIndex]);
                this.history.push([this.cubes.indexOf(this.draggedCube), cubeInPositionIndex]);
                this.scoreBoard.addScore(this.draggedCube.value);
            }
            this.releaseCube();
        }

        if (this.hoveringOverCube) this.hoveringOverCube.stroke = false;

        off('touchmove mousemove', canvas, this.draggingCubeHandler);

        this.updateGameStatus();
    }

    updateGameStatus() {
        if (this.winCondition()) {
            this.hasWon = true;
            this.stopListeningToCubeEvents();
        } else if (!this.hasLost && !this.thereArePossibleCombinations()) {
            alert(`Game Over \nScore: ${this.scoreBoard.score}`);
            this.hasLost = true;
        }
    }

    draggingCube(e) {
        const [x, y] = resolveEventPositionOnCanvas(e);

        if (this.draggedCube) {

            if (this.hoveringOverCube) this.hoveringOverCube.stroke = false;

            this.draggedCube.updatePosition(x, y);
            const cubeInPositionIndex = this.cubeInPosition(x, y);
            const cubeInPosition = this.cubes[cubeInPositionIndex];
            if (cubeInPositionIndex >= 0 && Cube.canBeCombined(this.draggedCube, cubeInPosition) && !this.cubeIsCovered(cubeInPosition)) {
                this.hoveringOverCube = cubeInPosition;
                cubeInPosition.stroke = true;
                this.draggedCube.opacity = 0.5;
                this.draggedCube.stroke = true;
            } else {
                this.draggedCube.stroke = false;
                this.draggedCube.opacity = 1;
            }
        }
    }

    listenToCubeEvents() {
        on('touchstart mousedown', canvas, this.movementStartHandler);
        on('touchend mouseup', document, this.movementEndHandler);
    }

    stopListeningToCubeEvents() {
        off('touchstart mousedown', canvas, this.movementStartHandler);
        off('touchend mouseup', document, this.movementEndHandler);
    }

    winCondition() {
        return this.cubes.filter(cube => !cube.disabled && cube.value == 128).length == 4;
    }

    coveringCubes(cube) {
        const { cubeCoordinates: [x, y, z] } = cube;
        if (x == 1) return [];
        const activeCubesAbove = this.cubes.filter(activeCube => !activeCube.disabled && activeCube.cubeCoordinates[0] == x - 1 && activeCube != cube);

        const cubeFilter = (y, z) => ({ cubeCoordinates: [, cubeY, cubeZ] }) => cubeY == y && cubeZ == z;
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
            const { cubeCoordinates: [x, y, z] } = cube;
            if (x == 6) return false;
            const cubeBelow = this.cubes.find(cubeBelow => {
                const { cubeCoordinates: [xBelow, yBelow, zBelow] } = cubeBelow;
                return x + 1 == xBelow && y == yBelow && z == zBelow;
            });

            return Cube.canBeCombined(cubeBelow, cube);
        });
    }

    draw() {
        this.scoreBoard.draw();
        if (!this.hasWon) {
            for (const cube of this.cubes) {
                if (!cube.dragging && !cube.disabled) cube.draw();
            }

            if (this.draggedCube) this.draggedCube.draw();
        } else {
            for (const cube of this.cubes) {
                if (!cube.disabled) cube.drawRotate();
            }
        }
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
        this.updatePosition(x, y);
    }

    savePosition() {
        const { x, y } = this;
        this.restorePosition = () => {
            this.updatePosition(x, y);
        }
    }

    setComplement(x = 0, y = 0) {
        this.xComplement = x, this.yComplement = y;
    }

    updatePosition(x, y, z) {
        this.x = x - this.xComplement;
        this.y = y - this.yComplement;
        if (z) this.z = z;
        this.paths = Cube.cubePaths(x - this.xComplement, y - this.yComplement);
    }

    draw() {
        Cube.drawCube(this.x, this.y, this.paths, this.color, this.value, this.stroke, this.opacity);
    }

    drawRotate() {
        ctx.translate(this.x + CUBE_WIDTH / 2, this.y + CUBE_HEIGHT / 2);
        ctx.rotate(Math.PI / 180 * this.rotation);
        ctx.translate(-(this.x + CUBE_WIDTH / 2), -(this.y + CUBE_HEIGHT / 2));
        this.rotation += 3;
        if (this.rotation == 360) this.rotation = 0;
        this.draw();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    static isInPath(cube, x, y) {
        const [, , , backdrop] = cube.paths;
        return ctx.isPointInPath(backdrop, x, y);
    }

    static drawCube(x, y, paths, color, n = 2, stroke = true, opacity = 1) {
        const [top, left, right, backdrop] = paths;
        const [topColor, leftColor, rightColor] = CUBE_COLORS[color];

        if (opacity !== 1) {
            ctx.globalAlpha = opacity;
        }

        ctx.font = `bold ${FONT_SIZE} sans-serif`;
        ctx.fillStyle = topColor;
        ctx.fill(backdrop);
        ctx.fill(top);
        ctx.fillStyle = leftColor;
        ctx.fill(left);
        ctx.fillStyle = rightColor;
        ctx.fill(right);

        ctx.globalAlpha = 1;

        if (stroke) {
            ctx.stroke(top);
            ctx.stroke(left);
            ctx.stroke(right);
        }

        ctx.fillStyle = '#000';
        ctx.fillText(n, x + CUBE_WIDTH / 2, y + (CUBE_HEIGHT / 64 * 5));
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
}

class ScoreBoard {
    constructor(seed) {
        this.score = 0;
        this.seed = seed;
        this.x = canvasWidth / 2;
        this.y = HEIGHT_CENTER - CUBE_HEIGHT * 6;
    }

    addScore(n) {
        this.score += n * 10;
    }

    subtractScore(n) {
        this.score -= n * 10;
    }

    draw() {
        ctx.font = `small-caps bolder 20px sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(`score: ${this.score}`, this.x, this.y - 10);
        ctx.fillText(`seed: ${this.seed}`, this.x, this.y - 5 + CUBE_HEIGHT / 2);
    }
}

const game = new Game();

function resolveEventPositionOnCanvas(e) {
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

function isValidSeed(seed) {
    return (((+seed).toString().length == 7) && /\d{7}/.test(seed));
}

function scaleCubeSizes(scale = 1) {
    scale *= 10;
    const width = 5 * scale;
    const height = 3 * scale;
    const fontSize = `${1.1 * scale}px`;

    return [width, height, fontSize];
}

function shuffle(array, seed = +String(Math.floor(Math.random() * 10e6)).padStart(7, '1')) {
    const shuffledArray = [...array];
    let currentIndex = shuffledArray.length, seedOffset = 0, temporaryValue, randomIndex;
    const random = () => {
        const x = Math.sin(seed + seedOffset) * 10000;
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
    return [shuffledArray, seed];
}

function on(events, target, handler) {
    for (const event of events.split(' ')) {
        target.addEventListener(event, handler);
    }
}

function off(events, target, handler) {
    for (const event of events.split(' ')) {
        target.removeEventListener(event, handler);
    }
}
