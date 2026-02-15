import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
let client;
let clientPromise;

if (!process.env.MONGODB_URI) {
  throw new Error('Please add your Mongo URI to .env.local');
}

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export default async function handler(req, res) {
  const client = await clientPromise;
  const db = client.db('jawa');
  const collection = db.collection('games');

  const { action, code, uid, name, answer } = req.body || req.query;

  try {
    if (req.method === 'GET') {
      if (action === 'poll') {
        const room = await collection.findOne({ _id: code });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        return res.status(200).json(room);
      }
    }

    if (req.method === 'POST') {
      if (action === 'create') {
        const newRoom = {
          _id: code,
          hostId: uid,
          status: 'lobby',
          players: [{ uid, name, score: 0 }],
          questionData: null,
          createdAt: new Date(),
          endTime: null
        };
        await collection.insertOne(newRoom);
        return res.status(200).json({ success: true });
      }

      if (action === 'join') {
        const room = await collection.findOne({ _id: code });
        if (!room) return res.status(404).json({ error: 'Room not found' });
        
        const exists = room.players.find(p => p.uid === uid);
        if (!exists) {
          await collection.updateOne(
            { _id: code },
            { $push: { players: { uid, name, score: 0 } } }
          );
        }
        return res.status(200).json({ success: true });
      }

      if (action === 'start') {
        const response = await fetch('https://api.siputzx.my.id/api/games/family100');
        const json = await response.json();
        const data = json.status ? json.data : { soal: "Nama Buah", jawaban: ["Apel", "Jeruk", "Mangga"] };
        
        const answers = data.jawaban.map((txt, i) => ({
          text: txt,
          revealed: false,
          points: (data.jawaban.length - i) * 10,
          finder: null
        }));

        await collection.updateOne(
          { _id: code },
          { 
            $set: { 
              status: 'playing',
              questionData: { question: data.soal, answers },
              endTime: Date.now() + 120000 
            } 
          }
        );
        return res.status(200).json({ success: true });
      }

      if (action === 'submit') {
        const room = await collection.findOne({ _id: code });
        if (!room || !room.questionData) return res.status(400).json({ error: 'Invalid' });

        const answers = room.questionData.answers;
        const matchIdx = answers.findIndex(a => a.text.toLowerCase() === answer.toLowerCase() && !a.revealed);

        if (matchIdx !== -1) {
          const points = answers[matchIdx].points;
          answers[matchIdx].revealed = true;
          answers[matchIdx].finder = name;

          const updatedPlayers = room.players.map(p => 
            p.uid === uid ? { ...p, score: p.score + points } : p
          );

          await collection.updateOne(
            { _id: code },
            { 
              $set: { 
                'questionData.answers': answers,
                players: updatedPlayers
              } 
            }
          );
          return res.status(200).json({ correct: true, points });
        }
        return res.status(200).json({ correct: false });
      }
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
