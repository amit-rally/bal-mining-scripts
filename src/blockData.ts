const {
    getPoolData,
    addMarketCaps,
    poolMarketCap,
    PoolData,
} = require('./poolData');
const { scale, bnum } = require('./utils');
const poolAbi = require('../abi/BPool.json');
import * as BigNumber from 'bignumber.js';

interface UserPoolData {
    pool: string;
    feeFactor: string;
    balAndRatioFactor: string;
    wrapFactor: string;
    valueUSD: string;
    factorUSD: string;
}

interface TokenTotalMarketCaps {
    [address: string]: BigNumber.BigNumber;
}

export async function getRewardsAtBlock(
    web3,
    blockNum,
    bal_per_snapshot,
    pools,
    prices,
    poolProgress
) {
    let totalBalancerLiquidity = bnum(0);

    let block = await web3.eth.getBlock(blockNum);

    // All the pools that will be included in the calculation
    let allPoolData: typeof PoolData[] = [];
    let userPools: { [key: string]: UserPoolData[] } = {};
    let userLiquidity: { [key: string]: BigNumber.BigNumber } = {};

    poolProgress.update(0, { task: `Block ${blockNum} Progress` });

    // Gather data on all eligible pools
    for (const pool of pools) {
        const poolData = await getPoolData(web3, prices, block, pool);
        poolProgress.increment(1);
        if (
            poolData.privatePool ||
            poolData.unpriceable ||
            poolData.notCreatedByBlock
        ) {
            continue;
        }

        allPoolData.push(poolData);
    }

    // Sum the market cap of each token from it's presence in each pool
    let tokenTotalMarketCaps: TokenTotalMarketCaps = allPoolData.reduce(
        (t, poolData) => {
            return addMarketCaps(t, poolData);
        },
        {}
    );

    // Adjust pool market caps
    for (const poolData of allPoolData) {
        const finalPoolMarketCap = poolMarketCap(
            tokenTotalMarketCaps,
            poolData.tokens
        );
        // TODO this isn't actually a factor right?
        // calculate the final adjusted liquidity of the pool
        const finalPoolMarketCapFactor = poolData.feeFactor
            .times(poolData.balAndRatioFactor)
            .times(poolData.wrapFactor)
            .times(finalPoolMarketCap)
            .dp(18);

        totalBalancerLiquidity = totalBalancerLiquidity.plus(
            finalPoolMarketCapFactor
        );

        // Lookup the total supply from this pool
        let bPool = new web3.eth.Contract(poolAbi, poolData.poolAddress);
        let bptSupplyWei = await bPool.methods
            .totalSupply()
            .call(undefined, blockNum);
        let bptSupply = scale(bptSupplyWei, -18);

        // if total supply == 0, it's private
        const isPrivatePool = bptSupply.eq(bnum(0));
        if (isPrivatePool) {
            // Private pool
            const privatePool: UserPoolData = {
                pool: poolData.poolAddress,
                feeFactor: poolData.feeFactor.toString(),
                balAndRatioFactor: poolData.balAndRatioFactor.toString(),
                wrapFactor: poolData.wrapFactor.toString(),
                valueUSD: finalPoolMarketCap.toString(),
                factorUSD: finalPoolMarketCapFactor.toString(),
            };

            if (userPools[poolData.controller]) {
                userPools[poolData.controller].push(privatePool);
            } else {
                userPools[poolData.controller] = [privatePool];
            }

            // Add this pool liquidity to total user liquidity
            if (userLiquidity[poolData.controller]) {
                userLiquidity[poolData.controller] = userLiquidity[
                    poolData.controller
                ].plus(finalPoolMarketCapFactor);
            } else {
                userLiquidity[poolData.controller] = finalPoolMarketCapFactor;
            }
        } else {
            // Shared pool
            for (const holder of poolData.shareHolders) {
                let userBalanceWei = await bPool.methods
                    .balanceOf(holder)
                    .call(undefined, blockNum);
                let userBalance = scale(userBalanceWei, -18);
                let userPoolValue = userBalance
                    .div(bptSupply)
                    .times(finalPoolMarketCap)
                    .dp(18);

                let userPoolValueFactor = userBalance
                    .div(bptSupply)
                    .times(finalPoolMarketCapFactor)
                    .dp(18);

                let sharedPool: UserPoolData = {
                    pool: poolData.poolAddress,
                    feeFactor: poolData.feeFactor.toString(),
                    balAndRatioFactor: poolData.balAndRatioFactor.toString(),
                    wrapFactor: poolData.wrapFactor.toString(),
                    valueUSD: userPoolValue.toString(),
                    factorUSD: userPoolValueFactor.toString(),
                };
                if (userPools[holder]) {
                    userPools[holder].push(sharedPool);
                } else {
                    userPools[holder] = [sharedPool];
                }

                // Add this pool liquidity to total user liquidity
                if (userLiquidity[holder]) {
                    userLiquidity[holder] = userLiquidity[holder].plus(
                        userPoolValueFactor
                    );
                } else {
                    userLiquidity[holder] = userPoolValueFactor;
                }
            }
        }

        poolProgress.increment(1);
    }

    // Final iteration across all users to calculate their BAL tokens for this block
    let userBalReceived: { [key: string]: BigNumber.BigNumber } = {};
    for (const user in userLiquidity) {
        userBalReceived[user] = userLiquidity[user]
            .times(bal_per_snapshot)
            .div(totalBalancerLiquidity);
    }

    return [userPools, userBalReceived, tokenTotalMarketCaps];
}
