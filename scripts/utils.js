import { MODULE_CONFIG } from '../applications/settings.js';

// Because PF2e is a special snowflake
export function cleanLayerName(layer) {
  return layer.name.replace('PF2e', '');
}

export function getGridColorString() {
  return canvas.scene?.grid?.color ?? '#000000';
}

export function getDispositionColor(token) {
  const colors = MODULE_CONFIG.dispositionColors;
  let d = parseInt(token.document.disposition);
  if (token.actor?.hasPlayerOwner) return colors.playerOwner;
  else if (d === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return colors.friendly;
  else if (d === CONST.TOKEN_DISPOSITIONS.NEUTRAL) return colors.neutral;
  else return colors.hostile;
}

let registeredWrappers = [];

/**
 * OVERRIDING SquareGrid and HexagonalGrid draw line functions
 * Contains original implementation of the functions with just the line width adjusted
 */
export function registerGridWrappers(lineWidth) {
  unregisterGridWrappers();
  if (typeof libWrapper === 'function') {
    let squareWrap;

    if (isNewerVersion('11', game.version)) {
      squareWrap = libWrapper.register(
        'aedifs-tactical-grid',
        'SquareGrid.prototype._drawLine',
        function (points, lineColor, lineAlpha) {
          let line = new PIXI.Graphics();
          line
            .lineStyle(lineWidth, lineColor, lineAlpha)
            .moveTo(points[0], points[1])
            .lineTo(points[2], points[3]);
          return line;
        },
        'OVERRIDE'
      );
    } else {
      squareWrap = libWrapper.register(
        'aedifs-tactical-grid',
        'SquareGrid.prototype.draw',
        function (options = {}) {
          Object.getPrototypeOf(SquareGrid).prototype.draw.call(this, options);
          // SquareGrid.prototype.draw.call(this, options);
          let { color, alpha, dimensions } = foundry.utils.mergeObject(this.options, options);

          // Set dimensions
          this.width = dimensions.width;
          this.height = dimensions.height;

          // Need to draw?
          if (alpha === 0) return this;

          // Vertical lines
          let nx = Math.floor(dimensions.width / dimensions.size);
          const grid = new PIXI.Graphics();
          for (let i = 1; i < nx; i++) {
            let x = i * dimensions.size;
            grid.lineStyle(lineWidth, color, alpha).moveTo(x, 0).lineTo(x, dimensions.height);
          }

          // Horizontal lines
          let ny = Math.ceil(dimensions.height / dimensions.size);
          for (let i = 1; i < ny; i++) {
            let y = i * dimensions.size;
            grid.lineStyle(lineWidth, color, alpha).moveTo(0, y).lineTo(dimensions.width, y);
          }
          this.addChild(grid);
          return this;
        },
        'OVERRIDE'
      );
    }

    let hexWrap = libWrapper.register(
      'aedifs-tactical-grid',
      'HexagonalGrid.prototype._drawGrid',
      function ({ color = null, alpha = null } = {}) {
        color = color ?? this.options.color;
        alpha = alpha ?? this.options.alpha;
        const columnar = this.columnar;
        const ncols = Math.ceil(canvas.dimensions.width / this.w);
        const nrows = Math.ceil(canvas.dimensions.height / this.h);

        // Draw Grid graphic
        const grid = new PIXI.Graphics();
        grid.lineStyle({ width: lineWidth, color, alpha });

        // Draw hex rows
        if (columnar) this._drawColumns(grid, nrows, ncols);
        else this._drawRows(grid, nrows, ncols);
        return grid;
      },
      'OVERRIDE'
    );

    registeredWrappers.push(squareWrap);
    registeredWrappers.push(hexWrap);
  }
}

export function unregisterGridWrappers() {
  if (typeof libWrapper === 'function') {
    for (const wrp of registeredWrappers) {
      libWrapper.unregister('aedifs-tactical-grid', wrp, false);
    }
    registeredWrappers = [];
  }
}

/**
 * Find the nearest point on a rectangle given a point on the scene
 * @param {*} rect {minX, maxX, minY, maxY}
 * @param {*} p {x, y}
 * @returns nearest point {x, y}
 */
export function nearestPointToRectangle(rect, p) {
  const nearest = { x: p.x, y: p.y };
  if (p.x < rect.minX) nearest.x = rect.minX;
  else if (p.x > rect.maxX) nearest.x = rect.maxX;

  if (p.y < rect.minY) nearest.y = rect.minY;
  else if (p.y > rect.maxY) nearest.y = rect.maxY;
  return nearest;
}

/**
 * Find the nearest point on a circle given a point on the scene
 * @param {*} c {x, y, r}
 * @param {*} p {x, y}
 * @returns nearest point {x, y}
 */
export function nearestPointToCircle(c, p) {
  // If c === p, return any edge
  if (c.x === p.x && c.y === p.y) return p;
  let vX = p.x - c.x;
  let vY = p.y - c.y;
  let magV = Math.sqrt(vX * vX + vY * vY);
  return { x: c.x + (vX / magV) * c.r, y: c.y + (vY / magV) * c.r };
}

// =======================================================
// Code Taken from MidiQOL and modified to not output logs
// =======================================================

const FULL_COVER = 999;
const THREE_QUARTERS_COVER = 5;
const HALF_COVER = 2;
let midiCoverCalculation;
export function computeCoverBonus(attacker, target) {
  let coverBonus = null;
  if (!attacker) return null;

  let calculator;
  if (MODULE_CONFIG.cover.calculator === 'midi-qol') {
    if (!midiCoverCalculation) {
      if (game.modules.get('midi-qol')?.active) {
        midiCoverCalculation =
          game.settings.get('midi-qol', 'ConfigSettings')?.optionalRules?.coverCalculation ||
          'none';
      } else midiCoverCalculation = 'none';
    }
    calculator = midiCoverCalculation;
  } else {
    calculator = MODULE_CONFIG.cover.calculator;
  }

  switch (calculator) {
    case 'levelsautocover':
      if (
        !game.modules.get('levelsautocover')?.active ||
        !game.settings.get('levelsautocover', 'apiMode')
      )
        return null;

      const coverData = AutoCover.calculateCover(
        attacker.document ? attacker : attacker.object,
        target.document ? target : target.object
      );

      const coverDetail = AutoCover.getCoverData();
      if (coverData.rawCover === 0) coverBonus = FULL_COVER;
      else if (coverData.rawCover > coverDetail[1].percent) coverBonus = 0;
      else if (coverData.rawCover < coverDetail[0].percent) coverBonus = THREE_QUARTERS_COVER;
      else if (coverData.rawCover < coverDetail[1].percent) coverBonus = HALF_COVER;
      if (coverData.obstructingToken) coverBonus = Math.max(2, coverBonus);
      break;
    case 'simbuls-cover-calculator':
      if (!game.modules.get('simbuls-cover-calculator')?.active) return null;
      if (globalThis.CoverCalculator) {
        const coverData = globalThis.CoverCalculator.Cover(
          attacker.document ? attacker : attacker.object,
          target
        );
        if (attacker === target) {
          coverBonus = 0;
          break;
        }
        if (coverData?.data?.results.cover === 3) coverBonus = FULL_COVER;
        else coverBonus = -coverData?.data?.results.value ?? 0;
      }
      break;
    case 'tokenvisibility':
      if (!game.modules.get('tokenvisibility')?.active) return null;
      const coverValue = calcTokenVisibilityCover(attacker, target);
      switch (coverValue) {
        case 1:
          coverBonus = HALF_COVER;
          break;
        case 2:
          coverBonus = THREE_QUARTERS_COVER;
          break;
        case 3:
          coverBonus = FULL_COVER;
          break;
        case 0:
        default:
          coverBonus = 0;
      }
      break;
    case 'pf2e-perception':
      if (!game.modules.get('pf2e-perception')?.active) return null;
      const coverValue = game.modules.get('pf2e-perception').api.token.getCover(attacker, target);
      switch (coverValue) {
        case undefined:
          coverBonus = 0
          break;
        case 'lesser':
          coverBonus = HALF_COVER;
          break;
        case 'standard':
          coverBonus = THREE_QUARTERS_COVER;
          break;
        case 'greater':
          coverBonus = FULL_COVER;
          break;
        case 'greater-prone':
          coverBonus = FULL_COVER;
          break;
        default:
          coverBonus = 0
      }
      break;
    case 'none':
    default:
      coverBonus = null;
      break;
  }

  return coverBonus;
}

function calcTokenVisibilityCover(attacker, target) {
  const api = game.modules.get('tokenvisibility')?.api;
  const attackerToken = attacker;
  const targetToken = target;
  if (!api || !attackerToken || !targetToken) return null;

  const coverCalc = new api.CoverCalculator(attackerToken, targetToken);

  return coverCalc.targetCover();

  // const version = game.modules.get('tokenvisibility')?.version;
  // let coverValue;
  // if (isNewerVersion(version, '0.5.3')) {
  //   const cover = api.CoverCalculator.coverCalculations(attackerToken, [targetToken]);
  //   coverValue = cover.get(targetToken) ?? 0;
  // } else {
  //   const cover = api.CoverCalculator.coverCalculations([attackerToken], [targetToken]);
  //   coverValue = cover[attackerToken.id][targetToken.id] ?? 0;
  // }
  // return coverValue;
}

// ===================
// End of MidiQOL code
// ===================
