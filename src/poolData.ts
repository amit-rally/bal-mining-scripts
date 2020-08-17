const poolAbi = require('../abi/BPool.json');
const tokenAbi = require('../abi/BToken.json');
const { bnum, scale } = require('./utils');
import { uncappedTokens } from './tokens';
const BigNumber = require('bignumber.js');

const MARKETCAP_CAP = bnum(10000000);

const {
    getFeeFactor,
    getBalFactor,
    getBalAndRatioFactor,
    getWrapFactor,
} = require('./factors');

BigNumber.config({
    EXPONENTIAL_AT: [-100, 100],
    ROUNDING_MODE: BigNumber.ROUND_DOWN,
    DECIMAL_PLACES: 18,
});

function atLeastTwoTokensHavePrice(tokens, prices) {
    let nTokensHavePrice = 0;
    for (const token of tokens) {
        if (prices[token] !== undefined && prices[token].length > 0) {
            nTokensHavePrice++;
            if (nTokensHavePrice > 1) {
                return true;
            }
        }
    }
    return false;
}

function poolCreatedByBlock(pool, block) {
    return pool.createTime < block.timestamp && pool.tokensList;
}

function closestPrice(token, timestamp, prices) {
    return prices[token].reduce((a, b) => {
        return Math.abs(b[0] - timestamp * 1000) <
            Math.abs(a[0] - timestamp * 1000)
            ? b
            : a;
    })[1];
}

interface TokenData {
    token: string;
    origMarketCap: typeof BigNumber;
    normWeight: typeof BigNumber;
}

async function tokenMetrics(
    web3,
    bPool,
    tokens,
    prices,
    block
): Promise<TokenData[]> {
    let tokenData: any[] = [];

    for (const token of tokens) {
        // Skip token if it doesn't have a price
        if (prices[token] === undefined || prices[token].length === 0) {
            continue;
        }
        let bToken = new web3.eth.Contract(tokenAbi, token);
        let tokenDecimals = await bToken.methods.decimals().call();

        let tokenBalanceWei = await bPool.methods
            .getBalance(token)
            .call(undefined, block.number);

        let normWeight = await bPool.methods
            .getNormalizedWeight(token)
            .call(undefined, block.number);

        let tokenBalance = scale(tokenBalanceWei, -tokenDecimals);
        let price = closestPrice(token, block.timestamp, prices);
        let origMarketCap = tokenBalance.times(bnum(price)).dp(18);

        tokenData.push({
            token,
            origMarketCap,
            normWeight: scale(normWeight, -18),
        });
    }

    return tokenData;
}

interface PoolData {
    poolAddress: string | undefined;
    tokens: any[];
    marketCap: number;
    eligibleTotalWeight: number;
    balAndRatioFactor: number;
    wrapFactor: number;
    feeFactor: number;
    originalPoolMarketCapFactor: number;
    shareHolders: any[];
    controller: string;
}

interface SkipReason {
    privatePool?: boolean;
    unpriceable?: boolean;
    notCreatedByBlock?: boolean;
}

export async function getPoolData(
    web3,
    prices,
    block,
    pool
): Promise<PoolData | SkipReason> {
    if (!poolCreatedByBlock(pool, block)) {
        return { notCreatedByBlock: true };
    }

    const bPool = new web3.eth.Contract(poolAbi, pool.id);

    const publicSwap = await bPool.methods
        .isPublicSwap()
        .call(undefined, block.number);

    if (!publicSwap) {
        return { privatePool: true };
    }

    const currentTokens = await bPool.methods
        .getCurrentTokens()
        .call(undefined, block.number);

    const poolTokens = currentTokens.map(web3.utils.toChecksumAddress);

    // If the pool is unpriceable, we cannot calculate any rewards
    if (!atLeastTwoTokensHavePrice(poolTokens, prices)) {
        return { unpriceable: true };
    }

    const tokenData = await tokenMetrics(
        web3,
        bPool,
        poolTokens,
        prices,
        block
    );

    const originalPoolMarketCap = tokenData.reduce(
        (a, t) => a + t.origMarketCap,
        bnum(0)
    );

    const eligibleTotalWeight = tokenData.reduce(
        (a, t) => a + t.normWeight,
        bnum(0)
    );

    const normWeights = tokenData.map((t) => t.normWeight);

    const balAndRatioFactor = getBalAndRatioFactor(poolTokens, normWeights);
    const wrapFactor = getWrapFactor(poolTokens, normWeights);

    let poolFee = await bPool.methods
        .getSwapFee()
        .call(undefined, block.number);
    poolFee = scale(poolFee, -16); // -16 = -18 * 100 since it's in percentage terms
    const feeFactor = bnum(getFeeFactor(poolFee));

    const originalPoolMarketCapFactor = feeFactor
        .times(balAndRatioFactor)
        .times(wrapFactor)
        .times(originalPoolMarketCap)
        .dp(18);

    return {
        poolAddress: pool.id,
        controller: pool.controller,
        shareHolders: pool.shareHolders,
        tokens: tokenData,
        marketCap: originalPoolMarketCap,
        eligibleTotalWeight,
        balAndRatioFactor,
        wrapFactor,
        feeFactor,
        originalPoolMarketCapFactor,
    };
}

export function addMarketCaps(tokenTotalMarketCaps, poolData) {
    const {
        tokens,
        eligibleTotalWeight,
        originalPoolMarketCapFactor,
    } = poolData;
    for (const r of tokens) {
        let tokenMarketCapWithCap = r.normWeight
            .div(eligibleTotalWeight)
            .times(originalPoolMarketCapFactor);

        if (tokenTotalMarketCaps[r.token]) {
            tokenTotalMarketCaps[r.token] = bnum(
                tokenTotalMarketCaps[r.token]
            ).plus(tokenMarketCapWithCap);
        } else {
            tokenTotalMarketCaps[r.token] = tokenMarketCapWithCap;
        }
    }
    return tokenTotalMarketCaps;
}

export function poolMarketCap(tokenTotalMarketCaps, tokens): typeof BigNumber {
    return tokens.reduce((aggregateAdjustedMarketCap, t) => {
        let adjustedTokenMarketCap;
        const shouldAdjustMarketCap =
            !uncappedTokens.includes(t.token) &&
            bnum(tokenTotalMarketCaps[t.token] || 0).isGreaterThan(
                MARKETCAP_CAP
            );
        // if the token is capped then we scale it's adjusted market cap
        // down to the cap
        if (shouldAdjustMarketCap) {
            let tokenMarketCapFactor = MARKETCAP_CAP.div(
                tokenTotalMarketCaps[t.token]
            );
            adjustedTokenMarketCap = t.origMarketCap
                .times(tokenMarketCapFactor)
                .dp(18);
        } else {
            adjustedTokenMarketCap = t.origMarketCap;
        }
        return aggregateAdjustedMarketCap.plus(adjustedTokenMarketCap);
    }, bnum(0));
}
