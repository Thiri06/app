import net from 'node:net';

export async function getAvailablePort(startPort: number): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(getAvailablePort(startPort + 1));
        return;
      }

      reject(error);
    });

    server.listen(startPort, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : startPort;

      server.close(() => resolve(port));
    });
  });
}
