import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Group = Tables<'groups'>;

interface BalanceEntry {
  userId: string;
  displayName: string;
  amount: number; // positive = they owe you, negative = you owe them
}

export default function Dashboard() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [balances, setBalances] = useState<BalanceEntry[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  async function loadData() {
    setLoading(true);
    const [groupsRes, expensesRes] = await Promise.all([
      supabase.from('groups').select('*').order('created_at', { ascending: false }),
      supabase.from('expenses').select('*, expense_splits(*), profiles:paid_by(display_name)').order('created_at', { ascending: false }).limit(10),
    ]);

    if (groupsRes.data) setGroups(groupsRes.data);
    if (expensesRes.data) setRecentExpenses(expensesRes.data);

    // Calculate balances across all groups
    await calculateBalances();
    setLoading(false);
  }

  async function calculateBalances() {
    if (!user) return;
    
    // Get all expenses with splits where user is involved
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*, expense_splits(*)');
    
    const { data: settlements } = await supabase
      .from('settlements')
      .select('*');

    const balanceMap: Record<string, number> = {};

    expenses?.forEach((expense) => {
      const splits = expense.expense_splits || [];
      if (expense.paid_by === user.id) {
        // User paid - others owe user their split amounts
        splits.forEach((split: any) => {
          if (split.user_id !== user.id) {
            balanceMap[split.user_id] = (balanceMap[split.user_id] || 0) + Number(split.amount);
          }
        });
      } else {
        // Someone else paid - check if user has a split
        const userSplit = splits.find((s: any) => s.user_id === user.id);
        if (userSplit) {
          balanceMap[expense.paid_by] = (balanceMap[expense.paid_by] || 0) - Number(userSplit.amount);
        }
      }
    });

    // Apply settlements
    settlements?.forEach((s) => {
      if (s.paid_by === user.id) {
        balanceMap[s.paid_to] = (balanceMap[s.paid_to] || 0) + Number(s.amount);
      } else if (s.paid_to === user.id) {
        balanceMap[s.paid_by] = (balanceMap[s.paid_by] || 0) - Number(s.amount);
      }
    });

    // Get profile names
    const userIds = Object.keys(balanceMap).filter(id => balanceMap[id] !== 0);
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds);
      
      const entries: BalanceEntry[] = userIds.map(id => ({
        userId: id,
        displayName: profiles?.find(p => p.id === id)?.display_name || 'Unknown',
        amount: balanceMap[id],
      }));
      setBalances(entries);
    } else {
      setBalances([]);
    }
  }

  const totalOwed = balances.filter(b => b.amount > 0).reduce((s, b) => s + b.amount, 0);
  const totalOwing = balances.filter(b => b.amount < 0).reduce((s, b) => s + Math.abs(b.amount), 0);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Your expense overview</p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-credit" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">You are owed</p>
                <p className="text-2xl font-heading font-bold text-credit">${totalOwed.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-debt" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">You owe</p>
                <p className="text-2xl font-heading font-bold text-debt">${totalOwing.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
                <Users className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Groups</p>
                <p className="text-2xl font-heading font-bold">{groups.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Balances */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading">Balances</CardTitle>
          <Wallet className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {balances.length === 0 ? (
            <p className="text-muted-foreground text-sm">All settled up! 🎉</p>
          ) : (
            <div className="space-y-3">
              {balances.map((b) => (
                <div key={b.userId} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="font-medium">{b.displayName}</span>
                  <span className={b.amount > 0 ? 'text-credit font-semibold' : 'text-debt font-semibold'}>
                    {b.amount > 0 ? `owes you $${b.amount.toFixed(2)}` : `you owe $${Math.abs(b.amount).toFixed(2)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent expenses */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-heading">Recent Expenses</CardTitle>
          <Link to="/groups">
            <Button variant="ghost" size="sm" className="gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentExpenses.length === 0 ? (
            <p className="text-muted-foreground text-sm">No expenses yet. Create a group to get started!</p>
          ) : (
            <div className="space-y-3">
              {recentExpenses.map((expense) => (
                <div key={expense.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">{expense.description}</p>
                    <p className="text-sm text-muted-foreground">
                      Paid by {expense.profiles?.display_name || 'Unknown'} · {new Date(expense.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-heading font-bold">${Number(expense.amount).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
