import { useEffect, useState } from 'react';
import { apiGet, apiPost, formatMoney, formatPct } from './api';
import { DailyChart, MinuteChart } from './charts';

type Page = 'market' | 'stock' | 'sector' | 'sync';

function Change({ value }: { value: unknown }) {
  const number = Number(value || 0);
  const className =
    number > 0 ? 'up' : number < 0 ? 'down' : '';

  return (
    <span className={className}>
      {formatPct(number)}
    </span>
  );
}

function StockTable({
  title,
  rows
}: {
  title: string;
  rows: any[];
}) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th>现价</th>
            <th>涨跌</th>
            <th>成交额</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td>{row.code}</td>
              <td>{row.name}</td>
              <td>{row.price}</td>
              <td><Change value={row.pct} /></td>
              <td>{formatMoney(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SectorTable({
  title,
  rows
}: {
  title: string;
  rows: any[];
}) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>板块</th>
            <th>涨跌</th>
            <th>上涨</th>
            <th>下跌</th>
            <th>领涨股</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.type}-${row.code}`}>
              <td>{row.name}</td>
              <td><Change value={row.pct} /></td>
              <td>{row.upCount ?? row.up_count ?? '-'}</td>
              <td>{row.downCount ?? row.down_count ?? '-'}</td>
              <td>{row.leadStock ?? row.lead_stock ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MarketPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      setData(
        await apiGet('/market/overview?live=true')
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return <div className="error">{error}</div>;
  }

  if (!data) {
    return <div className="notice">正在读取市场数据…</div>;
  }

  return (
    <>
      <div className="page-title">
        <div>
          <h2>市场总览</h2>
          <p>指数、涨跌家数、活跃股票和板块强弱</p>
        </div>
        <button onClick={() => void load()}>刷新</button>
      </div>

      <div className="index-grid">
        {data.indexes.map((item: any) => (
          <div className="card" key={item.code}>
            <span>{item.name}</span>
            <b>{item.quote?.price ?? '-'}</b>
            <Change value={item.quote?.pct} />
          </div>
        ))}
      </div>

      <div className="stat-grid">
        <div className="card">
          <b>{data.breadth.up}</b>
          <span>上涨家数</span>
        </div>
        <div className="card">
          <b>{data.breadth.down}</b>
          <span>下跌家数</span>
        </div>
        <div className="card">
          <b>{data.breadth.up3}</b>
          <span>涨幅 ≥ 3%</span>
        </div>
        <div className="card">
          <b>{data.breadth.down3}</b>
          <span>跌幅 ≤ -3%</span>
        </div>
        <div className="card">
          <b>{formatMoney(data.breadth.amount)}</b>
          <span>市场成交额</span>
        </div>
      </div>

      <div className="two-column">
        <StockTable
          title="涨幅前十"
          rows={data.breadth.topGainers || []}
        />
        <StockTable
          title="成交额前十"
          rows={data.breadth.topAmount || []}
        />
      </div>

      <div className="two-column">
        <SectorTable
          title="行业板块前十"
          rows={data.sectors.industryTop || []}
        />
        <SectorTable
          title="概念板块前十"
          rows={data.sectors.conceptTop || []}
        />
      </div>
    </>
  );
}

function StockPage() {
  const [input, setInput] = useState('600186');
  const [data, setData] = useState<any>(null);
  const [searchRows, setSearchRows] = useState<any[]>([]);
  const [error, setError] = useState('');

  const loadCode = async (code: string) => {
    setError('');
    setSearchRows([]);

    try {
      setData(await apiGet(`/ai/stock/${code}`));
      setInput(code);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const search = async () => {
    const value = input.trim();

    if (/^\d{6}$/.test(value)) {
      await loadCode(value);
      return;
    }

    setError('');
    try {
      const result = await apiGet<any>(
        `/stocks/search?q=${encodeURIComponent(value)}`
      );
      setSearchRows(result.data || []);
      if ((result.data || []).length === 0) {
        setError('没有找到匹配股票。名称搜索需要先完成一次“同步今日市场”。');
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  useEffect(() => {
    void loadCode('600186');
  }, []);

  return (
    <>
      <div className="page-title">
        <div>
          <h2>股票查询</h2>
          <p>支持代码或名称搜索，查看实时行情、历史日 K、分钟数据和技术指标</p>
        </div>
      </div>

      <div className="search">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入代码或名称，例如 600186 / 莲花"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void search();
          }}
        />
        <button onClick={() => void search()}>搜索</button>
      </div>

      {searchRows.length > 0 && (
        <section className="panel search-result">
          <h3>搜索结果</h3>
          <table>
            <thead>
              <tr>
                <th>代码</th>
                <th>名称</th>
                <th>市场</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {searchRows.map((row) => (
                <tr key={row.code}>
                  <td>{row.code}</td>
                  <td>{row.name}</td>
                  <td>{row.market_name}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => void loadCode(row.code)}
                    >
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {!data && !error && (
        <div className="notice">正在读取股票数据…</div>
      )}

      {data && (
        <>
          <div className="stock-head">
            <div>
              <span>{data.code}</span>
              <h2>
                {data.stock?.name ||
                  data.quote?.name ||
                  data.code}
              </h2>
            </div>
            <div>
              <b>{data.quote?.price ?? '-'}</b>
              <Change value={data.quote?.pct} />
            </div>
          </div>

          <div className="stat-grid">
            <div className="card">
              <b>{data.indicators?.ma5 ?? '-'}</b>
              <span>MA5</span>
            </div>
            <div className="card">
              <b>{data.indicators?.ma10 ?? '-'}</b>
              <span>MA10</span>
            </div>
            <div className="card">
              <b>{data.indicators?.ma20 ?? '-'}</b>
              <span>MA20</span>
            </div>
            <div className="card">
              <b>{formatPct(data.indicators?.return5)}</b>
              <span>5 日涨幅</span>
            </div>
            <div className="card">
              <b>{formatPct(data.indicators?.return20)}</b>
              <span>20 日涨幅</span>
            </div>
          </div>

          <section className="panel">
            <h3>历史日 K</h3>
            <DailyChart rows={data.daily || []} />
          </section>

          <section className="panel">
            <h3>1 分钟走势</h3>
            <MinuteChart rows={data.minute || []} />
          </section>
        </>
      )}
    </>
  );
}

function SectorPage() {
  const [industry, setIndustry] = useState<any[]>([]);
  const [concept, setConcept] = useState<any[]>([]);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const [a, b] = await Promise.all([
        apiGet<any>('/sectors?type=industry&live=true'),
        apiGet<any>('/sectors?type=concept&live=true')
      ]);

      setIndustry(a.data || []);
      setConcept(b.data || []);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <div className="page-title">
        <div>
          <h2>板块对比</h2>
          <p>行业板块和概念板块实时强弱</p>
        </div>
        <button onClick={() => void load()}>刷新</button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="two-column">
        <SectorTable title="行业板块" rows={industry} />
        <SectorTable title="概念板块" rows={concept} />
      </div>
    </>
  );
}

function SyncPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [days, setDays] = useState(120);
  const [message, setMessage] = useState('');

  const loadJobs = async () => {
    const result = await apiGet<any>('/sync/jobs?limit=30');
    setJobs(result.data || []);
  };

  useEffect(() => {
    void loadJobs();

    const timer = window.setInterval(
      () => void loadJobs(),
      3000
    );

    return () => window.clearInterval(timer);
  }, []);

  const start = async (
    path: string,
    body: unknown = {}
  ) => {
    await apiPost(path, body);
    setMessage('任务已提交');
    await loadJobs();
  };

  return (
    <>
      <div className="page-title">
        <div>
          <h2>数据同步</h2>
          <p>管理每日增量、板块数据和历史日 K</p>
        </div>
      </div>

      <div className="action-grid">
        <div className="card action-card">
          <h3>同步今日市场</h3>
          <p>分页获取全 A 股当天行情并写入 DuckDB。</p>
          <button onClick={() => void start('/sync/daily')}>
            开始同步
          </button>
        </div>

        <div className="card action-card">
          <h3>同步板块</h3>
          <p>更新行业和概念板块排名。</p>
          <button onClick={() => void start('/sync/sectors')}>
            开始同步
          </button>
        </div>

        <div className="card action-card">
          <h3>初始化历史日 K</h3>
          <p>首次使用执行，全市场逐只同步，耗时较长。</p>
          <div className="row">
            <input
              type="number"
              min={20}
              max={1000}
              value={days}
              onChange={(event) =>
                setDays(Number(event.target.value))
              }
            />
            <button
              onClick={() =>
                void start('/sync/history', { days })
              }
            >
              开始初始化
            </button>
          </div>
        </div>
      </div>

      {message && <div className="notice">{message}</div>}

      <section className="panel">
        <h3>任务记录</h3>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>状态</th>
              <th>进度</th>
              <th>说明</th>
              <th>开始时间</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.job_type}</td>
                <td>{job.status}</td>
                <td>{job.done}/{job.total}</td>
                <td>{job.message}</td>
                <td>
                  {String(job.started_at || '')
                    .replace('T', ' ')
                    .slice(0, 19)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('market');

  const menu: Array<[Page, string]> = [
    ['market', '市场总览'],
    ['stock', '股票查询'],
    ['sector', '板块对比'],
    ['sync', '数据同步']
  ];

  return (
    <div className="layout">
      <aside>
        <div className="brand">
          <b>Quant</b>
          <span>本地行情平台</span>
        </div>

        <nav>
          {menu.map(([key, label]) => (
            <button
              key={key}
              className={page === key ? 'active' : ''}
              onClick={() => setPage(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        {page === 'market' && <MarketPage />}
        {page === 'stock' && <StockPage />}
        {page === 'sector' && <SectorPage />}
        {page === 'sync' && <SyncPage />}
      </main>
    </div>
  );
}
