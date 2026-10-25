import {
  explainLocalApiError,
  loadFixtures,
  loadFixtureState,
  syncFixtures,
  verifyFixtureState,
} from "./lib/fixtures";
import { LocalApiClient } from "./lib/localApi";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const fixtures = await loadFixtures();
  const client = new LocalApiClient();

  try {
    const info = await client.getServerInfo();
    console.log(
      `Local API: server ${info.serverID}, API ${info.version ?? "unknown"}`,
    );
    if (checkOnly) {
      const status = await verifyFixtureState(client, fixtures);
      if (!status.ok) {
        console.error(status.reason);
        process.exitCode = 1;
        return;
      }
      console.log("夹具已是最新。");
      return;
    }

    console.log("同步 Local API 夹具…");
    const state = await syncFixtures(client, fixtures);
    console.log(
      `夹具已同步：${Object.keys(state.itemKeys).length} 个条目，${state.collectionKeys.length} 个集合。`,
    );
    console.log(`状态：test-gui/.state/fixtures.local.json`);
    const latest = await loadFixtureState();
    if (latest) {
      console.log(`fixture SHA：${latest.fixtureSha.slice(0, 16)}…`);
    }
  } catch (error) {
    console.error(explainLocalApiError(error));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
