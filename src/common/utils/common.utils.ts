export async function sleepFor(ms: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await new Promise((resolve: any) => {
    setTimeout(() => resolve(), ms);
  });
}
