export async function sleepFor(ms: number) {
  await new Promise<void>(resolve => {
    setTimeout(() => resolve(), ms);
  });
}
