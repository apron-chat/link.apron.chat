// @ts-check
/**
 * Makes QR codes, so a link shown on one device can be opened on another
 * (ISO/IEC 18004).
 *
 * Text goes in byte mode, except a run of digits at its end, such as a
 * message ID, which goes in numeric mode when that is shorter. A code takes
 * the smallest version that holds the text at error correction level M, which
 * stays readable off a screen with some glare, then the highest level that
 * still fits that version: once the size is set, more correction is free.
 * Byte mode carries no ECI header, so scanners guess the character set:
 * callers pass ASCII, as a link is.
 *
 * Written here rather than imported, because the page loads nothing from
 * another origin and the site has no dependencies. The steps follow Project
 * Nayuki's QR Code generator (MIT); the choice of level, and the digit run,
 * come from lean-qr (MIT).
 */

/** @typedef {'M' | 'Q' | 'H'} Level */

/**
 * Each level's two format bits, and by version (index 0 unused) its error
 * correction codewords per block and its number of blocks.
 * @type {Record<Level, { bits: number, ecc: number[], blocks: number[] }>}
 */
const LEVELS = {
	M: {
		bits: 0b00,
		ecc: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
		blocks: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
	},
	Q: {
		bits: 0b11,
		ecc: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
		blocks: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68]
	},
	H: {
		bits: 0b10,
		ecc: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
		blocks: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
	}
};

/** Text of up to this many bytes always fits in a code. */
export const MAX_BYTES = 2331;

/**
 * @typedef {object} QrCode
 * @property {number} version 1 to 40: the code is `version * 4 + 17` modules wide
 * @property {Level} level
 * @property {boolean[][]} modules row by row, true for dark, without the quiet zone
 */

/**
 * @param {string} text
 * @returns {QrCode}
 * @throws {RangeError} when `text` doesn't fit in a code
 */
export function qrCode(text) {
	const bytes = new TextEncoder().encode(text);
	for (let version = 1; version <= 40; version++) {
		const bits = dataBits(bytes, version);
		const fits = (/** @type {Level} */ level) => bits.length <= dataCodewords(version, level) * 8;
		if (!fits('M')) continue;
		const level = fits('H') ? 'H' : fits('Q') ? 'Q' : 'M';
		const data = padded(bits, dataCodewords(version, level));
		return { version, level, modules: new Code(version, level, withEcc(version, level, data)).modules };
	}
	throw new RangeError(`Too long for a QR code: ${bytes.length} bytes`);
}

/** Appends the low `length` bits of `value`, highest first. */
function append(/** @type {number[]} */ bits, /** @type {number} */ value, /** @type {number} */ length) {
	for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

const bit = (/** @type {number} */ value, /** @type {number} */ i) => ((value >>> i) & 1) !== 0;

/**
 * The segments for `bytes`: byte mode, or byte mode then numeric mode for
 * the digits at the end, whichever is shorter.
 * @param {Uint8Array} bytes
 * @param {number} version
 */
function dataBits(bytes, version) {
	let split = bytes.length;
	while (split > 0 && bytes[split - 1] >= 0x30 && bytes[split - 1] <= 0x39) split--;
	/** @type {number[]} */
	const plain = [];
	byteSegment(plain, bytes, version);
	if (split === bytes.length) return plain;
	/** @type {number[]} */
	const mixed = [];
	if (split > 0) byteSegment(mixed, bytes.subarray(0, split), version);
	numericSegment(mixed, bytes.subarray(split), version);
	return mixed.length < plain.length ? mixed : plain;
}

function byteSegment(/** @type {number[]} */ bits, /** @type {Uint8Array} */ bytes, /** @type {number} */ version) {
	append(bits, 0b0100, 4);
	append(bits, bytes.length, version < 10 ? 8 : 16);
	for (const byte of bytes) append(bits, byte, 8);
}

function numericSegment(/** @type {number[]} */ bits, /** @type {Uint8Array} */ digits, /** @type {number} */ version) {
	append(bits, 0b0001, 4);
	append(bits, digits.length, version < 10 ? 10 : version < 27 ? 12 : 14);
	// Three digits in 10 bits, and the last two in 7 or the last one in 4.
	for (let i = 0; i < digits.length; i += 3) {
		const group = digits.subarray(i, i + 3);
		append(bits, Number(String.fromCharCode(...group)), group.length * 3 + 1);
	}
}

/** The data codewords: the segments, a terminator, then padding to fill the version. */
function padded(/** @type {number[]} */ segments, /** @type {number} */ capacity) {
	const bits = [...segments];
	append(bits, 0, Math.min(4, capacity * 8 - bits.length));
	append(bits, 0, (8 - (bits.length % 8)) % 8);
	for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11) append(bits, pad, 8);
	const codewords = [];
	for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((byte, b) => (byte << 1) | b, 0));
	return codewords;
}

/** Modules that carry codewords and remainder bits, by version. */
function rawDataModules(/** @type {number} */ version) {
	let result = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const align = Math.floor(version / 7) + 2;
		result -= (25 * align - 10) * align - 55;
		if (version >= 7) result -= 36;
	}
	return result;
}

/** Data codewords a version holds at a level. */
export function dataCodewords(/** @type {number} */ version, /** @type {Level} */ level) {
	return Math.floor(rawDataModules(version) / 8) - LEVELS[level].ecc[version] * LEVELS[level].blocks[version];
}

/**
 * Splits the data into blocks, adds each block's error correction, and
 * interleaves them.
 * @param {number} version
 * @param {Level} level
 * @param {number[]} data
 */
function withEcc(version, level, data) {
	const blocks = LEVELS[level].blocks[version];
	const eccLength = LEVELS[level].ecc[version];
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
	/** @type {number[]} */
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

/** The 15 format bits for a level and mask, with their BCH code and XOR mask. */
export function formatBits(/** @type {Level} */ level, /** @type {number} */ mask) {
	const data = (LEVELS[level].bits << 3) | mask;
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

/** @type {((x: number, y: number) => boolean)[]} */
const MASKS = [
	(x, y) => (x + y) % 2 === 0,
	(x, y) => y % 2 === 0,
	(x) => x % 3 === 0,
	(x, y) => (x + y) % 3 === 0,
	(x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
	(x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
	(x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
	(x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

/** One code: its function patterns, its codewords, and the mask that scores best. */
class Code {
	/**
	 * @param {number} version
	 * @param {Level} level
	 * @param {number[]} codewords
	 */
	constructor(version, level, codewords) {
		this.size = version * 4 + 17;
		this.level = level;
		/** @type {boolean[][]} */
		this.modules = Array.from({ length: this.size }, () => Array(this.size).fill(false));
		/** Modules that are not data, and that masks leave alone. @type {boolean[][]} */
		this.reserved = Array.from({ length: this.size }, () => Array(this.size).fill(false));
		this.drawFunctionPatterns(version);
		this.drawCodewords(codewords);
		let best = 0;
		let lowest = Infinity;
		for (let mask = 0; mask < MASKS.length; mask++) {
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
		const bits = formatBits(this.level, mask);
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
		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) if (!this.reserved[y][x] && MASKS[mask](x, y)) this.modules[y][x] = !this.modules[y][x];
		}
	}

	/** The standard's penalty: long runs, 2×2 blocks, finder lookalikes, and dark/light imbalance. */
	penalty() {
		const { size, modules } = this;
		let result = 0;
		const columns = modules.map((_, x) => modules.map((row) => row[x]));
		for (const line of [...modules, ...columns]) {
			let color = false;
			let run = 0;
			// The lengths of the last seven runs, newest first. The quiet zone counts as a light run.
			const history = Array(7).fill(0);
			const addRun = (/** @type {number} */ length) => {
				if (history[0] === 0) length += size;
				history.pop();
				history.unshift(length);
			};
			// Dark-light-dark-dark-dark-light-dark at 1:1:3:1:1, with four light on one side.
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
