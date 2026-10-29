import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignmentPositions, dataCodewords, formatBits, MAX_BYTES, qrCode, reedSolomonDivisor, reedSolomonRemainder, versionBits } from '../src/qr.js';

/** @param {boolean[][]} modules */
const picture = (modules) => modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));

test('holds as many bytes as the standard says, at level M', () => {
	// ISO/IEC 18004 Table 7: byte mode capacity at level M.
	const bytes = (/** @type {number} */ version) => Math.floor((dataCodewords(version) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
	assert.deepEqual([1, 2, 7, 10, 27, 40].map(bytes), [14, 26, 122, 213, 1125, 2331]);
	assert.equal(MAX_BYTES, bytes(40));
});

test('picks the smallest version that fits', () => {
	const size = (/** @type {number} */ length) => qrCode('a'.repeat(length)).length;
	assert.equal(size(14), 21);
	assert.equal(size(15), 25);
	assert.equal(size(213), 57);
	assert.equal(size(214), 61);
	assert.equal(size(MAX_BYTES), 177);
	assert.throws(() => qrCode('a'.repeat(MAX_BYTES + 1)), RangeError);
	// Counted in UTF-8 bytes, not characters.
	assert.equal(qrCode('é'.repeat(7)).length, 21);
	assert.equal(qrCode('é'.repeat(8)).length, 25);
});

test('error correction matches the worked example in ISO/IEC 18004 Annex I', () => {
	const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
	assert.deepEqual(reedSolomonRemainder(data, reedSolomonDivisor(10)), [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
});

test('format, version and alignment patterns match the standard tables', () => {
	assert.equal(formatBits(0).toString(2), '101010000010010');
	assert.equal(formatBits(4).toString(2), '100010111111001');
	assert.equal(versionBits(7), 0x07c94);
	assert.equal(versionBits(40), 0x28c69);
	assert.deepEqual(alignmentPositions(1), []);
	assert.deepEqual(alignmentPositions(2), [6, 18]);
	assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
	assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
	assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test('draws a code that scanners read', () => {
	// Checked against a QR decoder (ZXing) when it was written.
	assert.deepEqual(picture(qrCode('https://link.apron.chat/')), [
		'#######.##.#..#...#######',
		'#.....#..######.#.#.....#',
		'#.###.#.##..###...#.###.#',
		'#.###.#..##.##.#..#.###.#',
		'#.###.#..#....#...#.###.#',
		'#.....#.####.##...#.....#',
		'#######.#.#.#.#.#.#######',
		'.........#.##..#.........',
		'#.#...##.#.#...#...#..#.#',
		'.#####.#.#..#..##.##.#.##',
		'#.#######.....####.####.#',
		'####.#.#.##...#..#.###...',
		'#.#.#.#.#.##...#..##....#',
		'..##.#.##.#..#.##.##...##',
		'###.#.###..#.###.....##.#',
		'..#.....#.........####...',
		'##.####.#..##..######..#.',
		'........#.#.#...#...#...#',
		'#######.#.#.###.#.#.#...#',
		'#.....#...###.###...#....',
		'#.###.#..#..#..######..#.',
		'#.###.#..#....#.##..#.##.',
		'#.###.#.##.#.#...#.###.##',
		'#.....#..####...#.###....',
		'#######.##..#.###....#..#'
	]);
});
