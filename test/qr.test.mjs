import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignmentPositions, dataCodewords, formatBits, MAX_BYTES, qrCode, reedSolomonDivisor, reedSolomonRemainder, versionBits } from '../src/qr.js';

/** @param {import('../src/qr.js').QrCode} code */
const pick = ({ version, level }) => ({ version, level });

/** @param {boolean[][]} modules */
const picture = (modules) => modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));

test('holds as many bytes as the standard says, at each level', () => {
	// ISO/IEC 18004 Table 7: byte mode capacity.
	const bytes = (/** @type {number} */ version, /** @type {'M' | 'Q' | 'H'} */ level) => Math.floor((dataCodewords(version, level) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
	assert.deepEqual([1, 2, 7, 10, 27, 40].map((version) => bytes(version, 'M')), [14, 26, 122, 213, 1125, 2331]);
	assert.deepEqual([1, 2, 10, 40].map((version) => bytes(version, 'Q')), [11, 20, 151, 1663]);
	assert.deepEqual([1, 2, 10, 40].map((version) => bytes(version, 'H')), [7, 14, 119, 1273]);
	assert.equal(MAX_BYTES, bytes(40, 'M'));
});

test('picks the smallest version that fits at level M', () => {
	const version = (/** @type {number} */ length) => qrCode('a'.repeat(length)).version;
	assert.equal(version(14), 1);
	assert.equal(version(15), 2);
	assert.equal(version(213), 10);
	assert.equal(version(214), 11);
	assert.equal(version(MAX_BYTES), 40);
	assert.throws(() => qrCode('a'.repeat(MAX_BYTES + 1)), RangeError);
	// Counted in UTF-8 bytes, not characters.
	assert.equal(qrCode('é'.repeat(7)).version, 1);
	assert.equal(qrCode('é'.repeat(8)).version, 2);
});

test('raises error correction when the version has room', () => {
	const level = (/** @type {number} */ length) => qrCode('a'.repeat(length)).level;
	assert.equal(level(7), 'H');
	assert.equal(level(8), 'Q');
	assert.equal(level(11), 'Q');
	assert.equal(level(12), 'M');
	assert.equal(qrCode('a'.repeat(14)).modules.length, 21);
});

test('puts the digits at the end in numeric mode', () => {
	// 13 digits: 58 bits in numeric mode, which fits version 1 at level H; 116 in byte mode.
	assert.deepEqual(pick(qrCode('1724803200042')), { version: 1, level: 'H' });
	// In byte mode, this would need version 6.
	assert.deepEqual(pick(qrCode('https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042')), { version: 5, level: 'M' });
	// Digits that aren't at the end stay in byte mode.
	assert.deepEqual(pick(qrCode('https://link.apron.chat/#message=1724803200042&room=general&server=wss://chat.example/ws')), { version: 6, level: 'M' });
});

test('error correction matches the worked example in ISO/IEC 18004 Annex I', () => {
	const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
	assert.deepEqual(reedSolomonRemainder(data, reedSolomonDivisor(10)), [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
});

test('format, version and alignment patterns match the standard tables', () => {
	const format = (/** @type {'M' | 'Q' | 'H'} */ level, /** @type {number} */ mask) => formatBits(level, mask).toString(2).padStart(15, '0');
	assert.equal(format('M', 0), '101010000010010');
	assert.equal(format('M', 4), '100010111111001');
	assert.equal(format('Q', 0), '011010101011111');
	assert.equal(format('H', 0), '001011010001001');
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
	assert.deepEqual(picture(qrCode('https://link.apron.chat/').modules), [
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
