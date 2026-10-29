// @ts-check
/**
 * Makes QR codes, so a link shown on one device can be opened on another
 * (ISO/IEC 18004). Byte mode and error correction level M only: a link is a
 * URL, and M keeps a code readable off a screen with some glare.
 *
 * Written here rather than imported, because the page loads nothing from
 * another origin and the site has no dependencies. The steps follow Project
 * Nayuki's QR Code generator (MIT).
 */

/** Error correction codewords per block, for level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
/** Error correction blocks, for level M, by version (index 0 unused). */
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
/** Level M's two format bits. */
const LEVEL_M = 0b00;

/** The most bytes a code can hold, at version 40. */
export const MAX_BYTES = 2331;

/**
 * The modules of a QR code for `text`, row by row: true is dark. The
 * smallest version that fits, without the quiet zone around it.
 * @param {string} text
 * @returns {boolean[][]}
 * @throws {RangeError} when `text` is longer than a code can hold
 */
export function qrCode(text) {
	const bytes = new TextEncoder().encode(text);
	let version = 1;
	while (4 + countBits(version) + bytes.length * 8 > dataCodewords(version) * 8) {
		if (++version > 40) throw new RangeError(`Too long for a QR code: ${bytes.length} bytes`);
	}
	return new Code(version, withEcc(version, dataBits(version, bytes))).modules;
}

/** Bits in the byte count, by version. */
function countBits(/** @type {number} */ version) {
	return version < 10 ? 8 : 16;
}

/** Modules that carry codewords and remainder bits, by version. */
export function rawDataModules(/** @type {number} */ version) {
	let result = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const align = Math.floor(version / 7) + 2;
		result -= (25 * align - 10) * align - 55;
		if (version >= 7) result -= 36;
	}
	return result;
}

/** Data codewords a version holds at level M. */
export function dataCodewords(/** @type {number} */ version) {
	return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];
}

/**
 * The data codewords: mode, count, bytes, terminator, then padding.
 * @param {number} version
 * @param {Uint8Array} bytes
 */
function dataBits(version, bytes) {
	/** @type {number[]} */
	const bits = [];
	const push = (/** @type {number} */ value, /** @type {number} */ length) => {
		for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
	};
	push(0b0100, 4);
	push(bytes.length, countBits(version));
	for (const byte of bytes) push(byte, 8);
	const capacity = dataCodewords(version) * 8;
	push(0, Math.min(4, capacity - bits.length));
	push(0, (8 - (bits.length % 8)) % 8);
	for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
	const codewords = [];
	for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
	return codewords;
}

/**
 * Splits the data into blocks, adds each block's error correction, and
 * interleaves them.
 * @param {number} version
 * @param {number[]} data
 */
function withEcc(version, data) {
	const blocks = BLOCKS[version];
	const eccLength = ECC_PER_BLOCK[version];
	const raw = Math.floor(rawDataModules(version) / 8);
	const shortBlocks = blocks - (raw % blocks);
	const shortLength = Math.floor(raw / blocks);
	const divisor = reedSolomonDivisor(eccLength);
	/** @type {number[][]} */
	const all = [];
	for (let i = 0, k = 0; i < blocks; i++) {
		const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
		k += block.length;
		const ecc = reedSolomonRemainder(block, divisor);
		// A placeholder, so that every block has the same length while interleaving.
		if (i < shortBlocks) block.push(0);
		all.push([...block, ...ecc]);
	}
	const result = [];
	for (let i = 0; i < all[0].length; i++) {
		all.forEach((block, j) => {
			if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]);
		});
	}
	return result;
}

/** The generator polynomial for `degree` codewords, highest power first, its leading 1 left out. */
export function reedSolomonDivisor(/** @type {number} */ degree) {
	const result = Array(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = multiply(result[j], root);
			if (j + 1 < degree) result[j] ^= result[j + 1];
		}
		root = multiply(root, 0x02);
	}
	return result;
}

/** The error correction codewords for `data`. */
export function reedSolomonRemainder(/** @type {number[]} */ data, /** @type {number[]} */ divisor) {
	const result = Array(divisor.length).fill(0);
	for (const byte of data) {
		const factor = byte ^ /** @type {number} */ (result.shift());
		result.push(0);
		divisor.forEach((coefficient, i) => (result[i] ^= multiply(coefficient, factor)));
	}
	return result;
}

/** Multiplies in GF(2^8), modulo x^8 + x^4 + x^3 + x^2 + 1. */
function multiply(/** @type {number} */ x, /** @type {number} */ y) {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z;
}

/** The centers of the alignment patterns along each axis, by version. */
export function alignmentPositions(/** @type {number} */ version) {
	if (version === 1) return [];
	const count = Math.floor(version / 7) + 2;
	const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
	const result = [6];
	for (let position = version * 4 + 10; result.length < count; position -= step) result.splice(1, 0, position);
	return result;
}

/** The 15 format bits for level M and `mask`, with their BCH code and XOR mask. */
export function formatBits(/** @type {number} */ mask) {
	const data = (LEVEL_M << 3) | mask;
	let remainder = data;
	for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
	return ((data << 10) | remainder) ^ 0x5412;
}

/** The 18 version bits, with their BCH code, for versions 7 and up. */
export function versionBits(/** @type {number} */ version) {
	let remainder = version;
	for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
	return (version << 12) | remainder;
}

const bit = (/** @type {number} */ value, /** @type {number} */ i) => ((value >>> i) & 1) !== 0;

/** One code: its function patterns, codewords, and the mask that scores best. */
class Code {
	/**
	 * @param {number} version
	 * @param {number[]} codewords
	 */
	constructor(version, codewords) {
		this.size = version * 4 + 17;
		/** @type {boolean[][]} */
		this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
		/** @type {boolean[][]} */
		this.reserved = Array.from({ length: this.size }, () => Array(this.size).fill(false));
		this.drawFunctionPatterns(version);
		this.drawCodewords(codewords);
		let best = 0;
		let lowest = Infinity;
		for (let mask = 0; mask < 8; mask++) {
			this.applyMask(mask);
			this.drawFormat(mask);
			const score = this.penalty();
			if (score < lowest) [best, lowest] = [mask, score];
			// Masking twice undoes it.
			this.applyMask(mask);
		}
		this.applyMask(best);
		this.drawFormat(best);
	}

	/** Sets a module that is not data, and keeps it from data and masks. */
	set(/** @type {number} */ x, /** @type {number} */ y, /** @type {boolean} */ dark) {
		this.modules[y][x] = dark;
		this.reserved[y][x] = true;
	}

	drawFunctionPatterns(/** @type {number} */ version) {
		const { size } = this;
		for (let i = 0; i < size; i++) {
			this.set(6, i, i % 2 === 0);
			this.set(i, 6, i % 2 === 0);
		}
		for (const [x, y] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
			for (let dy = -4; dy <= 4; dy++) {
				for (let dx = -4; dx <= 4; dx++) {
					const distance = Math.max(Math.abs(dx), Math.abs(dy));
					if (x + dx >= 0 && x + dx < size && y + dy >= 0 && y + dy < size) this.set(x + dx, y + dy, distance !== 2 && distance !== 4);
				}
			}
		}
		const positions = alignmentPositions(version);
		const last = positions.length - 1;
		positions.forEach((x, i) =>
			positions.forEach((y, j) => {
				// The three corners with finder patterns have none.
				if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
				for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
			})
		);
		// Reserves the format areas until a mask is chosen.
		this.drawFormat(0);
		if (version >= 7) {
			const bits = versionBits(version);
			for (let i = 0; i < 18; i++) {
				const a = size - 11 + (i % 3);
				const b = Math.floor(i / 3);
				this.set(a, b, bit(bits, i));
				this.set(b, a, bit(bits, i));
			}
		}
	}

	drawFormat(/** @type {number} */ mask) {
		const { size } = this;
		const bits = formatBits(mask);
		for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
		this.set(8, 7, bit(bits, 6));
		this.set(8, 8, bit(bits, 7));
		this.set(7, 8, bit(bits, 8));
		for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
		for (let i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(bits, i));
		for (let i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(bits, i));
		this.set(8, size - 8, true);
	}

	/** Places the codewords in the zigzag of two-module columns, from the bottom right. */
	drawCodewords(/** @type {number[]} */ codewords) {
		const { size } = this;
		let i = 0;
		for (let right = size - 1; right >= 1; right -= 2) {
			// The vertical timing pattern takes a whole column.
			if (right === 6) right = 5;
			const upward = ((right + 1) & 2) === 0;
			for (let vertical = 0; vertical < size; vertical++) {
				const y = upward ? size - 1 - vertical : vertical;
				for (let j = 0; j < 2; j++) {
					const x = right - j;
					if (this.reserved[y][x] || i >= codewords.length * 8) continue;
					this.modules[y][x] = bit(codewords[i >>> 3], 7 - (i & 7));
					i++;
				}
			}
		}
	}

	applyMask(/** @type {number} */ mask) {
		/** @type {((x: number, y: number) => boolean)[]} */
		const masks = [
			(x, y) => (x + y) % 2 === 0,
			(x, y) => y % 2 === 0,
			(x) => x % 3 === 0,
			(x, y) => (x + y) % 3 === 0,
			(x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
			(x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
			(x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
			(x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
		];
		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) if (!this.reserved[y][x] && masks[mask](x, y)) this.modules[y][x] = !this.modules[y][x];
		}
	}

	/** The standard's penalty: long runs, 2×2 blocks, finder lookalikes, and dark/light imbalance. */
	penalty() {
		const { size, modules } = this;
		let result = 0;
		const lines = [modules, modules.map((_, x) => modules.map((row) => row[x]))];
		for (const line of lines.flat()) {
			let color = false;
			let run = 0;
			// The lengths of the last seven runs, newest first; the first is light, from the quiet zone.
			const history = Array(7).fill(0);
			const addRun = (/** @type {number} */ length) => {
				if (history[0] === 0) length += size;
				history.pop();
				history.unshift(length);
			};
			const finderLike = () => {
				const n = history[1];
				const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
				return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
			};
			for (const dark of line) {
				if (dark === color) {
					run++;
					if (run === 5) result += 3;
					else if (run > 5) result++;
				} else {
					addRun(run);
					if (!color) result += finderLike() * 40;
					color = dark;
					run = 1;
				}
			}
			if (color) {
				addRun(run);
				run = 0;
			}
			addRun(run + size);
			result += finderLike() * 40;
		}
		for (let y = 0; y < size - 1; y++) {
			for (let x = 0; x < size - 1; x++) {
				const c = modules[y][x];
				if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
			}
		}
		const dark = modules.flat().filter(Boolean).length;
		const total = size * size;
		result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
		return result;
	}
}
