export function isUncertainChatError(error = {}) {
  const status = Number(error.status || 0);
  return status === 0 || status === 502 || status === 504 || error.code === "chat_timeout";
}

export async function waitForChatCompletion({
  requestId = "",
  getStatus,
  maxWaitMs = 12_000,
  intervalMs = 1_000,
  sleep = delay
} = {}) {
  if (!String(requestId || "").trim() || typeof getStatus !== "function") return { state: "not_found" };
  const deadline = Date.now() + Math.max(0, Number(maxWaitMs) || 0);
  while (Date.now() <= deadline) {
    try {
      const status = await getStatus(requestId);
      if (status?.state === "completed" && status.response) return status;
      if (status?.state === "not_found") return { state: "not_found" };
    } catch (error) {
      if (error?.code === "request_not_found" || Number(error?.status) === 404) return { state: "not_found" };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(Math.max(1, Number(intervalMs) || 1), remaining));
  }
  return { state: "pending" };
}

export async function requestChatWithRecovery({ requestId, send, getStatus, retry = true } = {}) {
  try {
    return await send();
  } catch (error) {
    if (!isUncertainChatError(error)) throw error;
    const recovered = await waitForChatCompletion({ requestId, getStatus });
    if (recovered.state === "completed") return recovered.response;
    if (!retry || recovered.state === "pending") {
      error.recoveryPending = recovered.state === "pending";
      throw error;
    }
    try {
      return await send();
    } catch (retryError) {
      if (isUncertainChatError(retryError)) retryError.recoveryPending = true;
      throw retryError;
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
