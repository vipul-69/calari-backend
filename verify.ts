const fetch = require("node-fetch");

async function verifyPayment() {
  const response = await fetch(`https://test.dodopayments.com/payments/pay_JHnjbi0WdDXvbuXD26kR2`, {
    method: "GET",
    headers: {
      Authorization: `Bearer gqsfkrQRiXK5qhJ2.VGh7T50ESKPL7ydqLxqLS4bIjogrQRNGrZbrclRAkadbR30O`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Error verifying payment: ${response.statusText}`);
  }

  const data = await response.json();
  console.log(data); // Contains payment details
  return data.status === "succeeded";
}


verifyPayment()
