const { expect, assert } = require('chai');
const { getRewardsAtBlock } = require('../lib/blockData');
const { bnum } = require('../lib/utils');
const { mockWeb3, mockPrices, mockBlock, mockPool } = require('./mocks');
const cliProgress = require('cli-progress');

const mockPoolProgress = {
    update: () => {},
    increment: () => {},
};

describe('getBlockData', () => {
    it('should return a blockData object', async () => {
        let result = await getRewardsAtBlock(
            mockWeb3,
            mockBlock.number,
            bnum(1000),
            [mockPool],
            mockPrices,
            mockPoolProgress
        );
        let userAddress = '0x59a068cc4540c8b8f8ff808ed37fae06584be019';
        let tokenAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
        let expectedUserPool = {
            factorUSD: '0.000000000000000045',
            feeFactor: '1',
            pool: '0xfff29c8bce4fbe8702e9fa16e0e6c551f364f420',
            ratioFactor: '1',
            valueUSD: '0.000000000000000045',
            wrapFactor: '1',
        };

        assert.deepEqual(
            result[0][userAddress],
            [expectedUserPool],
            'should return user pools'
        );

        assert.deepEqual(
            result[1][userAddress].toNumber(),
            98.03921568627452,
            'should return user bal received'
        );

        assert.deepEqual(
            result[2][tokenAddress].toNumber(),
            2.295e-16,
            'should return token total market caps'
        );
    });
});
