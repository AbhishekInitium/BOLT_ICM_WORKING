import React from 'react';
import { ArrowLeft, Download, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { format } from 'date-fns';

interface ExecutionResult {
  success: boolean;
  message: string;
  data: {
    totalRecords: number;
    processedAt: string;
    summary: {
      totalAgents: number;
      qualified: number;
      totalPayout: number;
    };
    agents: Array<{
      agentId: string;
      qualified: boolean;
      commission: number;
      qualifyingCriteria: Array<{
        rule: string;
        result: boolean;
        details?: string;
      }>;
      adjustments: Array<{
        rule: string;
        applied: boolean;
        value: number;
        details?: string;
      }>;
      exclusions: Array<{
        rule: string;
        applied: boolean;
        details?: string;
      }>;
      creditSplits: Array<{
        repId: string;
        role: string;
        amount: number;
        effectiveFrom: string;
        effectiveTo: string;
      }>;
    }>;
  };
}

export function SchemeResults() {
  const navigate = useNavigate();
  const location = useLocation();
  const result = location.state?.result as ExecutionResult;

  if (!result) {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4">
        <Card className="bg-yellow-50 p-6 rounded-xl border border-yellow-200">
          <div className="flex items-center space-x-3 text-yellow-800">
            <AlertCircle className="h-6 w-6" />
            <h3 className="text-lg font-medium">No Results Available</h3>
          </div>
          <p className="mt-2 text-yellow-700">
            Please execute a scheme to view results.
          </p>
          <Button
            onClick={() => navigate('/execution')}
            variant="outline"
            className="mt-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Return to Execution
          </Button>
        </Card>
      </div>
    );
  }

  const { data } = result;

  const downloadResults = () => {
    const jsonStr = JSON.stringify(result, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scheme_results_${format(new Date(), 'yyyyMMdd_HHmmss')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto py-12 px-4 space-y-8">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Button
            onClick={() => navigate('/execution')}
            variant="outline"
            className="rounded-full"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Execution
          </Button>
          <h1 className="text-3xl font-semibold text-slate-800">Execution Results</h1>
        </div>
        <Button
          onClick={downloadResults}
          className="rounded-full bg-black text-white hover:opacity-90"
        >
          <Download className="h-4 w-4 mr-2" />
          Download Results
        </Button>
      </div>

      <Card className="bg-gray-50 rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex items-center space-x-3 mb-6">
          {result.success ? (
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          ) : (
            <AlertCircle className="h-6 w-6 text-red-600" />
          )}
          <h2 className="text-xl font-semibold text-slate-800">Summary</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-500">Total Records</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">
              {data.totalRecords.toLocaleString()}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-500">Total Agents</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">
              {data.summary.totalAgents.toLocaleString()}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-500">Qualified Agents</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">
              {data.summary.qualified.toLocaleString()}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="text-sm font-medium text-gray-500">Total Payout</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">
              ${data.summary.totalPayout.toLocaleString()}
            </div>
          </div>
        </div>
      </Card>

      <Card className="bg-gray-50 rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="flex items-center space-x-3 mb-6">
          <FileSpreadsheet className="h-6 w-6 text-indigo-600" />
          <h2 className="text-xl font-semibold text-slate-800">Agent Results</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Agent ID
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Commission
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Adjustments
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Credit Splits
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.agents.map((agent) => (
                <tr key={agent.agentId}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {agent.agentId}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {agent.qualified ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        Qualified
                      </span>
                    ) : (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                        Not Qualified
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${agent.commission.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {agent.adjustments.length}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {agent.creditSplits.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}