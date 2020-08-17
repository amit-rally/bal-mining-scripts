const { expect, assert } = require('chai');
const {
    getPoolData,
    addMarketCaps,
    poolMarketCap,
} = require('../lib/poolData');
const { mockWeb3, mockPrices, mockBlock, mockPool } = require('./mocks');

describe('getPoolData', () => {
    it('should return a poolData object', async () => {
        let result = await getPoolData(
            mockWeb3,
            mockPrices,
            mockBlock,
            mockPool
        );
        let expectedEligleTotalWeight = 0.8;
        assert.deepEqual(
            result.eligibleTotalWeight.toNumber(),
            expectedEligleTotalWeight,
            'should properly construct pool data'
        );
    });
});

let tokenTotalMarketCaps = {
    0xb4efd85c19999d84251304bda99e90b92300bd93: 100,
    0x80fb784b7ed66730e8b1dbd9820afd29931aab03: 100,
};

let tokens = [
    {
        token: '0xB4EFd85c19999D84251304bDA99E90B92300Bd93',
        origMarketCap: 10,
        normWeight: 10,
    },
    {
        token: '0x80fB784B7eD66730e8b1DBd9820aFD29931aab03',
        origMarketCap: 10,
        normWeight: 10,
    },
];

describe('poolMarketCap', () => {
    it('calculates the pools adjust market cap', () => {
        let result = poolMarketCap(tokenTotalMarketCaps, tokens);
        let expectedResult = 20;

        assert.equal(
            result,
            expectedResult,
            'should properly calculate the pools market cap'
        );
    });
});
