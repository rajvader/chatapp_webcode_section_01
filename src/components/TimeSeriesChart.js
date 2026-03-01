import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

function TimeSeriesTooltip({ active, payload, label, metricColumn }) {
  if (!active || !payload?.length) return null;
  
  // Grab the video title we passed as 'label' in dataTools.js
  const videoTitle = payload[0].payload.label;
  
  return (
    <div style={{
      background: 'rgba(15, 15, 35, 0.94)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 10,
      padding: '0.65rem 0.85rem',
      fontSize: '0.8rem',
      color: '#e2e8f0',
      boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
    }}>
      {/* Show the video title and the date! */}
      <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>{videoTitle}</div>
      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: 6 }}>{label}</div>
      <div>{metricColumn}: <strong>{Number(payload[0].value).toLocaleString()}</strong></div>
    </div>
  );
}

export default function TimeSeriesChart({ data, metricColumn, height = 280 }) {
  if (!data?.length) return null;

  return (
    <div className="time-series-chart-wrap">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 18, left: 2, bottom: 64 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
          
          {/* ✨ MAGIC FIX: Changed dataKey from "name" to "x" so it finds the dates! ✨ */}
          <XAxis
            dataKey="x"
            tick={{ fill: 'rgba(255,255,255,0.58)', fontSize: 11, fontFamily: 'Inter,sans-serif' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
            tickLine={false}
            angle={-28}
            textAnchor="end"
            interval={Math.max(0, Math.floor(data.length / 8))}
          />
          
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'Inter,sans-serif' }}
            axisLine={false}
            tickLine={false}
            width={58}
          />
          
          <Tooltip content={<TimeSeriesTooltip metricColumn={metricColumn} />} cursor={{ stroke: 'rgba(99,102,241,0.45)' }} />
          
          <Line
            type="monotone"
            dataKey={metricColumn}
            stroke="#818cf8"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}