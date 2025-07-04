import express from "express";
import dns from "dns/promises";
import net from "net";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());

const isValidEmailFormat = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

const verifyEmailSMTP = async (email) => {
  const [, domain] = email.split("@");
  const mxRecords = await dns.resolveMx(domain);

  if (!mxRecords || mxRecords.length === 0) throw new Error("No MX records");

  const sortedMX = mxRecords.sort((a, b) => a.priority - b.priority);

  for (const mx of sortedMX) {
    try {
      const valid = await smtpHandshake(mx.exchange, email);
      if (valid) return true;
    } catch (err) {
      continue;
    }
  }

  return false;
};

const smtpHandshake = (host, targetEmail) => {
  return new Promise((resolve, reject) => {
    const sender = "validator@example.com";
    const socket = net.createConnection(25, host);
    let response = "";
    let step = 0;
    let isDone = false;

    const quit = () => {
      if (!isDone) {
        isDone = true;
        socket.write("QUIT\r\n");
        socket.end();
      }
    };

    socket.setEncoding("utf-8");
    socket.setTimeout(8000);

    socket.on("data", (data) => {
      response += data;

      if (step === 0 && data.includes("220")) {
        socket.write(`HELO ${host}\r\n`);
        step++;
      } else if (step === 1 && data.includes("250")) {
        socket.write(`MAIL FROM:<${sender}>\r\n`);
        step++;
      } else if (step === 2 && data.includes("250")) {
        socket.write(`RCPT TO:<${targetEmail}>\r\n`);
        step++;
      } else if (step === 3) {
        quit();
        const isValid = !data.includes("550");
        return resolve(isValid);
      }
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP timeout"));
    });

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });

    socket.on("end", () => {
      if (!isDone) {
        const isValid = !response.includes("550");
        resolve(isValid);
      }
    });
  });
};

app.get("/validate", async (req, res) => {
  const { email } = req.query;

  if (!email || !isValidEmailFormat(email)) {
    return res.status(400).json({ valid: false, reason: "Invalid format" });
  }

  try {
    const valid = await verifyEmailSMTP(email);
    res.json({ valid });
  } catch (err) {
    res.status(200).json({ valid: false, reason: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`server is running at http://localhost:${PORT}`);
});
