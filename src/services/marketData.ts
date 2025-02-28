import axios from "axios";
import {
  type TrendingToken,
  type TokenAnalysis,
  type SelectedToken,
  type JupiterTokenData,
} from "../types/market";
import connectToDatabase from "../utils/database";
import { config } from "dotenv";
config();

const BASE_URL = "https://api.dexscreener.com";
const JUPITER_BASE_URL = "https://datapi.jup.ag";

const headers = {
  accept: "application/json",
};

export async function getTrendingTokens(): Promise<TrendingToken[]> {
  try {
    const response = await axios.get(
      `${JUPITER_BASE_URL}/v1/pools/toptraded/1h`,
      { headers }
    );

    if (
      !response.data ||
      !response.data.pools ||
      !Array.isArray(response.data.pools)
    ) {
      throw new Error("Invalid response from Jupiter API");
    }

    // Extract token information from pools and map to TrendingToken format
    return response.data.pools
      .filter((pool: any) => pool.chain === "solana" && pool.baseAsset)
      .map((pool: any, index: number) => ({
        address: pool.baseAsset.id,
        rank: index,
        symbol: pool.baseAsset.symbol,
        name: pool.baseAsset.name,
      }))
      .slice(0, 1);
  } catch (error) {
    console.error("Error fetching trending tokens from Jupiter:", error);
    throw error;
  }
}

export async function getTokenData(address: string): Promise<JupiterTokenData> {
  console.log("Fetching data from Jupiter API for", address);
  try {
    // First get the top traded pools
    const response = await axios.get(
      `${JUPITER_BASE_URL}/v1/pools/toptraded/1h`,
      { headers }
    );

    if (
      !response.data ||
      !response.data.pools ||
      !Array.isArray(response.data.pools)
    ) {
      throw new Error("Invalid response from Jupiter API");
    }

    // Find the pool that contains our token
    const pool = response.data.pools.find(
      (p: any) => p.baseAsset?.id === address
    );

    if (!pool) {
      throw new Error(`No data found for token ${address} in Jupiter API`);
    }

    // Format data to match what's expected by getBestTradingOpportunity
    const tokenData: JupiterTokenData = {
      baseToken: {
        address: pool.baseAsset.id,
        symbol: pool.baseAsset.symbol,
        name: pool.baseAsset.name,
      },
      priceNative: pool.baseAsset.usdPrice.toString(),
      marketCap: pool.baseAsset.mcap || 0,
      volume: {
        h1:
          pool.baseAsset.stats1h?.buyVolume +
            pool.baseAsset.stats1h?.sellVolume || 0,
      },
      liquidity: {
        base: pool.liquidity || 0,
      },
      priceChange: {
        h1: pool.baseAsset.stats1h?.priceChange || 0,
      },
    };

    return tokenData;
  } catch (error) {
    console.error(
      `Error fetching data from DexScreener for ${address}:`,
      error
    );
    throw error;
  }
}

export async function getBestTradingOpportunity(): Promise<{
  analysis: TokenAnalysis;
  selectedToken: SelectedToken;
} | null> {
  try {
    await connectToDatabase();

    // Get top trending tokens - now with more data included from Jupiter
    console.log(`Get top trading tokens from Jupiter`);
    const trendingTokens = await getTrendingTokens();

    // We can limit to top 5-10 tokens for analysis
    const tokensToAnalyze = trendingTokens.slice(0, 10);

    // Analyze each token
    const analyses: TokenAnalysis[] = await Promise.all(
      tokensToAnalyze.map(async (token) => {
        // Use the updated getTokenData function that now fetches from Jupiter first
        const data: JupiterTokenData = await getTokenData(token.address);

        const volumeToMarketCap = data.volume.h1 / data.marketCap;
        const volumeToLiquidity = data.volume.h1 / data.liquidity.base;

        // Add Jupiter-specific metrics if available
        const organicVolume1h =
          (data.baseAsset?.stats1h?.buyOrganicVolume || 0) +
          (data.baseAsset?.stats1h?.sellOrganicVolume || 0);

        const organicBuyerCount =
          data.baseAsset?.stats1h?.numOrganicBuyers || 0;
        const organicScore = data.baseAsset?.organicScore || 0;

        return {
          address: data.baseToken.address,
          symbol: data.baseToken.symbol,
          name: data.baseToken.name,
          price: parseFloat(data.priceNative),
          marketCap: data.marketCap,
          volume1h: data.volume.h1,
          volumeToMarketCap,
          volumeToLiquidity,
          priceChange1h: data.priceChange.h1,
          // New metrics from Jupiter
          organicVolume1h,
          organicBuyerCount,
          organicScore,
        };
      })
    );

    // Create a composite score that considers multiple factors
    // - volumeToMarketCap (higher is better)
    // - organicScore (higher is better)
    // - organicBuyerCount (higher is better)
    analyses.forEach((token) => {
      token.compositeScore =
        token.volumeToMarketCap * 0.6 +
        ((token.organicScore || 0) / 100) * 0.25 +
        ((token.organicBuyerCount || 0) / 100) * 0.15;
    });

    // Sort by composite score instead of just volumeToMarketCap
    analyses.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

    const bestAnalysis = analyses[0];
    if (!bestAnalysis) return null;

    const selectedToken = {
      address: bestAnalysis.address,
      symbol: bestAnalysis.symbol,
      name: bestAnalysis.name,
      entryPrice: bestAnalysis.price,
      entryTime: new Date(),
      volumeToMarketCapAtEntry: bestAnalysis.volumeToMarketCap,
      compositeScoreAtEntry: bestAnalysis.compositeScore,
      lastAnalyzed: new Date(),
      isActive: true,
    };

    return { analysis: bestAnalysis, selectedToken: selectedToken };
  } catch (error) {
    console.error("Error finding best trading opportunity:", error);
    throw error;
  }
}
