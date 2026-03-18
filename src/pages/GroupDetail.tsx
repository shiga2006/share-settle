import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, DollarSign, Plus, UserPlus, Wallet } from 'lucide-react';
import { toast } from 'sonner';

interface Member {
  user_id: string;
  display_name: string;
  email: string | null;
}

interface Expense {
  id: string;
  description: string;
  amount: number;
  paid_by: string;
  split_type: string;
  created_at: string;
  payer_name: string;
}

interface Balance {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
}

export default function GroupDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [groupName, setGroupName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);

  // Add member
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  // Add expense
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expPaidBy, setExpPaidBy] = useState('');
  const [expSplitType, setExpSplitType] = useState('equal');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [addingExpense, setAddingExpense] = useState(false);

  // Settle
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleTo, setSettleTo] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (id) loadAll();
  }, [id]);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadGroup(), loadMembers(), loadExpenses()]);
    setLoading(false);
  }

  async function loadGroup() {
    const { data } = await supabase.from('groups').select('name').eq('id', id!).single();
    if (data) setGroupName(data.name);
  }

  async function loadMembers() {
    const { data } = await supabase
      .from('group_members')
      .select('user_id, profiles:user_id(display_name, email)')
      .eq('group_id', id!);
    if (data) {
      const mapped = data.map((d: any) => ({
        user_id: d.user_id,
        display_name: d.profiles?.display_name || 'Unknown',
        email: d.profiles?.email || null,
      }));
      setMembers(mapped);
    }
  }

  async function loadExpenses() {
    const { data: expData } = await supabase
      .from('expenses')
      .select('*, expense_splits(*), profiles:paid_by(display_name)')
      .eq('group_id', id!)
      .order('created_at', { ascending: false });

    const { data: settleData } = await supabase
      .from('settlements')
      .select('*')
      .eq('group_id', id!);

    if (expData) {
      setExpenses(expData.map((e: any) => ({
        id: e.id,
        description: e.description,
        amount: Number(e.amount),
        paid_by: e.paid_by,
        split_type: e.split_type,
        created_at: e.created_at,
        payer_name: e.profiles?.display_name || 'Unknown',
      })));

      // Calculate balances
      const netMap: Record<string, Record<string, number>> = {};
      
      expData.forEach((exp: any) => {
        const splits = exp.expense_splits || [];
        splits.forEach((split: any) => {
          if (split.user_id !== exp.paid_by) {
            const from = split.user_id;
            const to = exp.paid_by;
            if (!netMap[from]) netMap[from] = {};
            netMap[from][to] = (netMap[from][to] || 0) + Number(split.amount);
          }
        });
      });

      // Apply settlements
      settleData?.forEach((s) => {
        const from = s.paid_by; // person paying back
        const to = s.paid_to; // person receiving
        // Settlement reduces what "from" owes "to"
        if (!netMap[from]) netMap[from] = {};
        netMap[from][to] = (netMap[from][to] || 0) - Number(s.amount);
      });

      // Simplify: net out bidirectional debts
      const simplified: Balance[] = [];
      const processed = new Set<string>();

      Object.entries(netMap).forEach(([from, tos]) => {
        Object.entries(tos).forEach(([to, amount]) => {
          const key = [from, to].sort().join('-');
          if (processed.has(key)) return;
          processed.add(key);

          const reverse = netMap[to]?.[from] || 0;
          const net = amount - reverse;
          if (Math.abs(net) > 0.01) {
            simplified.push({
              from: net > 0 ? from : to,
              fromName: '',
              to: net > 0 ? to : from,
              toName: '',
              amount: Math.abs(net),
            });
          }
        });
      });

      setBalances(simplified);
    }
  }

  // Resolve names for balances after members load
  useEffect(() => {
    if (members.length > 0 && balances.length > 0) {
      setBalances(prev => prev.map(b => ({
        ...b,
        fromName: members.find(m => m.user_id === b.from)?.display_name || 'Unknown',
        toName: members.find(m => m.user_id === b.to)?.display_name || 'Unknown',
      })));
    }
  }, [members]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!memberEmail.trim()) return;
    setAddingMember(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', memberEmail.trim().toLowerCase())
        .single();
      if (!profile) throw new Error('User not found. They need to sign up first.');

      const { error } = await supabase
        .from('group_members')
        .insert({ group_id: id!, user_id: profile.id });
      if (error) throw error;

      toast.success('Member added!');
      setMemberEmail('');
      setAddMemberOpen(false);
      loadMembers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAddingMember(false);
    }
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !expDesc.trim() || !expAmount || !expPaidBy || selectedMembers.length === 0) return;
    setAddingExpense(true);
    try {
      const amount = parseFloat(expAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');

      // Validate custom splits
      let splitAmounts: Record<string, number> = {};
      if (expSplitType === 'equal') {
        const perPerson = Math.round((amount / selectedMembers.length) * 100) / 100;
        selectedMembers.forEach(uid => { splitAmounts[uid] = perPerson; });
        // Adjust rounding
        const diff = amount - (perPerson * selectedMembers.length);
        if (Math.abs(diff) > 0.001) {
          splitAmounts[selectedMembers[0]] += Math.round(diff * 100) / 100;
        }
      } else {
        let total = 0;
        selectedMembers.forEach(uid => {
          const val = parseFloat(customAmounts[uid] || '0');
          splitAmounts[uid] = val;
          total += val;
        });
        if (Math.abs(total - amount) > 0.01) throw new Error(`Custom splits must add up to $${amount}. Current total: $${total.toFixed(2)}`);
      }

      const { data: expense, error } = await supabase
        .from('expenses')
        .insert({
          group_id: id!,
          description: expDesc.trim(),
          amount,
          paid_by: expPaidBy,
          split_type: expSplitType,
        })
        .select()
        .single();
      if (error) throw error;

      // Insert splits
      const splits = Object.entries(splitAmounts).map(([uid, amt]) => ({
        expense_id: expense.id,
        user_id: uid,
        amount: amt,
      }));
      const { error: splitError } = await supabase.from('expense_splits').insert(splits);
      if (splitError) throw splitError;

      toast.success('Expense added!');
      setExpDesc('');
      setExpAmount('');
      setExpPaidBy('');
      setSelectedMembers([]);
      setCustomAmounts({});
      setExpenseOpen(false);
      loadExpenses();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAddingExpense(false);
    }
  }

  async function settleDebt(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !settleTo || !settleAmount) return;
    setSettling(true);
    try {
      const amount = parseFloat(settleAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');

      const { error } = await supabase.from('settlements').insert({
        group_id: id!,
        paid_by: user.id,
        paid_to: settleTo,
        amount,
      });
      if (error) throw error;

      toast.success('Payment settled!');
      setSettleTo('');
      setSettleAmount('');
      setSettleOpen(false);
      loadExpenses();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSettling(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/groups">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-heading font-bold">{groupName}</h1>
          <p className="text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <Dialog open={expenseOpen} onOpenChange={setExpenseOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" /> Add Expense</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading">Add Expense</DialogTitle>
            </DialogHeader>
            <form onSubmit={addExpense} className="space-y-4">
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={expDesc} onChange={e => setExpDesc(e.target.value)} placeholder="Dinner, taxi, etc." required maxLength={200} />
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" min="0.01" value={expAmount} onChange={e => setExpAmount(e.target.value)} placeholder="0.00" required />
              </div>
              <div className="space-y-2">
                <Label>Paid by</Label>
                <Select value={expPaidBy} onValueChange={setExpPaidBy}>
                  <SelectTrigger><SelectValue placeholder="Who paid?" /></SelectTrigger>
                  <SelectContent>
                    {members.map(m => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Split type</Label>
                <Select value={expSplitType} onValueChange={setExpSplitType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equal">Equal split</SelectItem>
                    <SelectItem value="custom">Custom amounts</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Split between</Label>
                <div className="space-y-2">
                  {members.map(m => (
                    <div key={m.user_id} className="flex items-center gap-3">
                      <Checkbox
                        checked={selectedMembers.includes(m.user_id)}
                        onCheckedChange={(checked) => {
                          setSelectedMembers(prev =>
                            checked ? [...prev, m.user_id] : prev.filter(id => id !== m.user_id)
                          );
                        }}
                      />
                      <span className="text-sm flex-1">{m.display_name}</span>
                      {expSplitType === 'custom' && selectedMembers.includes(m.user_id) && (
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-24"
                          placeholder="$0.00"
                          value={customAmounts[m.user_id] || ''}
                          onChange={e => setCustomAmounts(prev => ({ ...prev, [m.user_id]: e.target.value }))}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={addingExpense}>
                {addingExpense ? 'Adding...' : 'Add Expense'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2"><UserPlus className="h-4 w-4" /> Add Member</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading">Add Member</DialogTitle>
            </DialogHeader>
            <form onSubmit={addMember} className="space-y-4">
              <div className="space-y-2">
                <Label>Email address</Label>
                <Input type="email" value={memberEmail} onChange={e => setMemberEmail(e.target.value)} placeholder="friend@example.com" required />
                <p className="text-xs text-muted-foreground">The person must have a SplitEase account</p>
              </div>
              <Button type="submit" className="w-full" disabled={addingMember}>
                {addingMember ? 'Adding...' : 'Add Member'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2"><Wallet className="h-4 w-4" /> Settle Up</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-heading">Settle Payment</DialogTitle>
            </DialogHeader>
            <form onSubmit={settleDebt} className="space-y-4">
              <div className="space-y-2">
                <Label>Pay to</Label>
                <Select value={settleTo} onValueChange={setSettleTo}>
                  <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                  <SelectContent>
                    {members.filter(m => m.user_id !== user?.id).map(m => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" min="0.01" value={settleAmount} onChange={e => setSettleAmount(e.target.value)} placeholder="0.00" required />
              </div>
              <Button type="submit" className="w-full" disabled={settling}>
                {settling ? 'Settling...' : 'Record Payment'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Balances */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Who Owes Whom
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balances.length === 0 ? (
            <p className="text-muted-foreground text-sm">All settled up! 🎉</p>
          ) : (
            <div className="space-y-3">
              {balances.map((b, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="text-sm">
                    <span className="font-semibold text-debt">{b.fromName}</span>
                    {' → '}
                    <span className="font-semibold text-credit">{b.toName}</span>
                  </span>
                  <span className="font-heading font-bold">${b.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Members</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center gap-3 py-2 border-b last:border-0">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                  {m.display_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-sm">{m.display_name}</p>
                  {m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Expenses */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading flex items-center gap-2">
            <DollarSign className="h-5 w-5" /> Expenses
          </CardTitle>
        </CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <p className="text-muted-foreground text-sm">No expenses yet</p>
          ) : (
            <div className="space-y-3">
              {expenses.map(exp => (
                <div key={exp.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">{exp.description}</p>
                    <p className="text-sm text-muted-foreground">
                      Paid by {exp.payer_name} · {exp.split_type} split · {new Date(exp.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-heading font-bold">${exp.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
